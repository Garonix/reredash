import unicodedata
from urllib.parse import quote, urlparse, parse_qs, urlencode, urlunparse

import regex
from flask import make_response, request
from flask_login import current_user
from flask_restful import abort

from redash import models, settings
from redash.handlers.base import BaseResource, get_object_or_404, record_event
from redash.models.parameterized_query import (
    InvalidParameterError,
    ParameterizedQuery,
    QueryDetachedFromDataSourceError,
    dropdown_values,
)
from redash.permissions import (
    has_access,
    not_view_only,
    require_access,
    require_any_of_permission,
    require_permission,
    view_only,
)
from redash.serializers import (
    serialize_job,
    serialize_query_result,
    serialize_query_result_to_dsv,
    serialize_query_result_to_xlsx,
)
from redash.tasks import Job
from redash.tasks.queries import enqueue_query
from redash.utils import (
    collect_parameters_from_request,
    json_dumps,
    to_filename,
)


def error_response(message, http_status=400):
    return {"job": {"status": 4, "error": message}}, http_status


error_messages = {
    "unsafe_when_shared": error_response(
        "此查询包含潜在的不安全参数，无法在共享仪表板或嵌入可视化中执行。",
        403,
    ),
    "unsafe_on_view_only": error_response(
        "此查询包含潜在的不安全参数，无法在只读访问此数据源时执行。",
        403,
    ),
    "no_permission": error_response("您没有权限使用此数据源运行查询。", 403),
    "select_data_source": error_response("请选择数据源以运行此查询。", 401),
    "no_data_source": error_response("目标数据源不可用。", 401),
}


def run_query(query, parameters, data_source, query_id, should_apply_auto_limit, max_age=0, query_start=None, query_end=None):
    if not data_source:
        return error_messages["no_data_source"]

    if data_source.paused:
        if data_source.pause_reason:
            message = "{} 已暂停 ({}). 请稍后重试.".format(data_source.name, data_source.pause_reason)
        else:
            message = "{} 已暂停. 请稍后重试.".format(data_source.name)

        return error_response(message)

    try:
        query.apply(parameters)
    except (InvalidParameterError, QueryDetachedFromDataSourceError) as e:
        abort(400, message=str(e))

    query_text = data_source.query_runner.apply_auto_limit(query.text, should_apply_auto_limit)
    print('===================query_text=================', query_text)
    if query_start or query_end:
        # 使用&分割query_text
        new_query_text = query_text.split("&")[0]
        print('===================new_query_text=================', new_query_text)
        new_query_text += f"&start={query_start}"
        new_query_text += f"&end={query_end}"
        query_text = new_query_text
    
    print('===================new_query=================', query_text)

    if query.missing_params:
        return error_response("缺少参数值: {}".format(", ".join(query.missing_params)))

    # 在调用 get_latest 前打印 query_text，追踪参数流向
    if max_age == 0:
        query_result = None
    else:
        print('===================before_get_latest_query_text=================', query_text, flush=True)
        query_result = models.QueryResult.get_latest(data_source, query_text, max_age)

    record_event(
        current_user.org,
        current_user,
        {
            "action": "execute_query",
            "cache": "hit" if query_result else "miss",
            "object_id": data_source.id,
            "object_type": "data_source",
            "query": query_text,
            "query_id": query_id,
            "parameters": parameters,
        },
    )

    if query_result:
        return {"query_result": serialize_query_result(query_result, current_user.is_api_user())}
    else:
        job = enqueue_query(
            query_text,
            data_source,
            current_user.id,
            current_user.is_api_user(),
            metadata={
                "Username": current_user.get_actual_user(),
                "query_id": query_id,
            },
        )
        return serialize_job(job)


def get_download_filename(query_result, query, filetype):
    retrieved_at = query_result.retrieved_at.strftime("%Y_%m_%d")
    if query:
        query_name = regex.sub(r"\p{C}", "", query.name)
        filename = to_filename(query_name) if query_name != "" else str(query.id)
    else:
        filename = str(query_result.id)
    return "{}_{}.{}".format(filename, retrieved_at, filetype)


def content_disposition_filenames(attachment_filename):
    if not isinstance(attachment_filename, str):
        attachment_filename = attachment_filename.decode("utf-8")

    try:
        attachment_filename = attachment_filename.encode("ascii")
    except UnicodeEncodeError:
        filenames = {
            "filename": unicodedata.normalize("NFKD", attachment_filename).encode("ascii", "ignore"),
            "filename*": "UTF-8''%s" % quote(attachment_filename, safe=b""),
        }
    else:
        filenames = {"filename": attachment_filename}

    return filenames


class QueryResultListResource(BaseResource):
    @require_permission("execute_query")
    def post(self):
        """
        执行查询（或检索最近结果）。

        :qparam string query: 要执行的查询文本
        :qparam number query_id: 要更新结果的查询对象（可选）
        :qparam number max_age: 如果查询结果小于 `max_age` 秒，则返回它们，否则执行查询；如果省略或 -1，返回任何缓存结果，或如果不可用则执行
        :qparam number data_source_id: 要查询的数据源 ID
        :qparam object parameters: 要应用到查询的参数值集合
        """
        params = request.get_json(force=True)

        query = params["query"]
        max_age = params.get("max_age", -1)
        # max_age might have the value of None, in which case calling int(None) will fail
        if max_age is None:
            max_age = -1
        max_age = int(max_age)
        query_id = params.get("query_id", "adhoc")
        parameters = params.get("parameters", collect_parameters_from_request(request.args))

        parameterized_query = ParameterizedQuery(query, org=self.current_org)
        should_apply_auto_limit = params.get("apply_auto_limit", False)

        data_source_id = params.get("data_source_id")
        if data_source_id:
            data_source = models.DataSource.get_by_id_and_org(params.get("data_source_id"), self.current_org)
        else:
            return error_messages["select_data_source"]

        if not has_access(data_source, self.current_user, not_view_only):
            return error_messages["no_permission"]

        return run_query(
            parameterized_query,
            parameters,
            data_source,
            query_id,
            should_apply_auto_limit,
            max_age,
        )


ONE_YEAR = 60 * 60 * 24 * 365.25


class QueryResultDropdownResource(BaseResource):
    def get(self, query_id):
        query = get_object_or_404(models.Query.get_by_id_and_org, query_id, self.current_org)
        require_access(query.data_source, current_user, view_only)
        try:
            return dropdown_values(query_id, self.current_org)
        except QueryDetachedFromDataSourceError as e:
            abort(400, message=str(e))


class QueryDropdownsResource(BaseResource):
    def get(self, query_id, dropdown_query_id):
        query = get_object_or_404(models.Query.get_by_id_and_org, query_id, self.current_org)
        require_access(query, current_user, view_only)

        related_queries_ids = [p["queryId"] for p in query.parameters if p["type"] == "query"]
        if int(dropdown_query_id) not in related_queries_ids:
            dropdown_query = get_object_or_404(models.Query.get_by_id_and_org, dropdown_query_id, self.current_org)
            require_access(dropdown_query.data_source, current_user, view_only)

        return dropdown_values(dropdown_query_id, self.current_org)


class QueryResultResource(BaseResource):
    @staticmethod
    def add_cors_headers(headers):
        if "Origin" in request.headers:
            origin = request.headers["Origin"]

            if set(["*", origin]) & settings.ACCESS_CONTROL_ALLOW_ORIGIN:
                headers["Access-Control-Allow-Origin"] = origin
                headers["Access-Control-Allow-Credentials"] = str(settings.ACCESS_CONTROL_ALLOW_CREDENTIALS).lower()

    @require_any_of_permission(("view_query", "execute_query"))
    def options(self, query_id=None, query_result_id=None, filetype="json"):
        headers = {}
        self.add_cors_headers(headers)

        if settings.ACCESS_CONTROL_REQUEST_METHOD:
            headers["Access-Control-Request-Method"] = settings.ACCESS_CONTROL_REQUEST_METHOD

        if settings.ACCESS_CONTROL_ALLOW_HEADERS:
            headers["Access-Control-Allow-Headers"] = settings.ACCESS_CONTROL_ALLOW_HEADERS

        return make_response("", 200, headers)

    @require_any_of_permission(("view_query", "execute_query"))
    def post(self, query_id):
        """
        执行保存的查询。

        :param number query_id: 查询 ID，用于获取结果
        :param object parameters: 要应用到查询的参数值集合
        :qparam number max_age: 如果查询结果小于 `max_age` 秒，则返回它们，否则执行查询；如果省略或 -1，返回任何缓存结果，或如果不可用则执行
        """
        params = request.get_json(force=True, silent=True) or {}
        parameter_values = params.get("parameters", {})

        start = params.get("start")
        end = params.get("end")
        # 现在 start 和 end 就是你前端传来的时间字符串
        print("=================start=================:", start)
        print("=================end=================:", end)
        max_age = params.get("max_age", -1)
        # max_age might have the value of None, in which case calling int(None) will fail
        if max_age is None:
            max_age = -1
        max_age = int(max_age)

        query = get_object_or_404(models.Query.get_by_id_and_org, query_id, self.current_org)

        allow_executing_with_view_only_permissions = query.parameterized.is_safe
        if "apply_auto_limit" in params:
            should_apply_auto_limit = params.get("apply_auto_limit", False)
        else:
            should_apply_auto_limit = query.options.get("apply_auto_limit", False)

        if has_access(query, self.current_user, allow_executing_with_view_only_permissions):
            return run_query(
                query.parameterized,
                parameter_values,
                query.data_source,
                query_id,
                should_apply_auto_limit,
                max_age,
                query_start=start,
                query_end=end,
            )
        else:
            if not query.parameterized.is_safe:
                if current_user.is_api_user():
                    return error_messages["unsafe_when_shared"]
                else:
                    return error_messages["unsafe_on_view_only"]
            else:
                return error_messages["no_permission"]

    @require_any_of_permission(("view_query", "execute_query"))
    def get(self, query_id=None, query_result_id=None, filetype="json"):
        """
        获取查询结果。

        :param number query_id: 查询 ID，用于获取结果
        :param number query_result_id: 查询结果 ID，用于获取特定结果
        :param string filetype: 返回格式。可选 'json', 'xlsx', 或 'csv'。默认为 'json'。

        :<json number id: 查询结果 ID
        :<json string query: 生成此结果的查询
        :<json string query_hash: 查询文本的哈希代码
        :<json object data: 查询输出
        :<json number data_source_id: 生成此结果的数据源 ID
        :<json number runtime: 执行时间（秒）
        :<json string retrieved_at: 查询检索日期/时间，ISO 格式
        """
        # TODO:
        # 本方法处理两种情况：通过 ID 获取结果和通过查询 ID 获取结果。
        # 它们需要被拆分，因为它们有不同的逻辑（例如，通过查询 ID 获取结果时
        # 应该检查查询参数，不应该缓存结果）。
        should_cache = query_result_id is not None

        query_result = None
        query = None

        if query_result_id:
            query_result = get_object_or_404(models.QueryResult.get_by_id_and_org, query_result_id, self.current_org)

        if query_id is not None:
            query = get_object_or_404(models.Query.get_by_id_and_org, query_id, self.current_org)

            if query_result is None and query is not None and query.latest_query_data_id is not None:
                query_result = get_object_or_404(
                    models.QueryResult.get_by_id_and_org,
                    query.latest_query_data_id,
                    self.current_org,
                )

            if query is not None and query_result is not None and self.current_user.is_api_user():
                if query.query_hash != query_result.query_hash:
                    abort(404, message="未找到此查询的缓存结果。")

        if query_result:
            require_access(query_result.data_source, self.current_user, view_only)

            if isinstance(self.current_user, models.ApiUser):
                event = {
                    "user_id": None,
                    "org_id": self.current_org.id,
                    "action": "api_get",
                    "api_key": self.current_user.name,
                    "file_type": filetype,
                    "user_agent": request.user_agent.string,
                    "ip": request.remote_addr,
                }

                if query_id:
                    event["object_type"] = "query"
                    event["object_id"] = query_id
                else:
                    event["object_type"] = "query_result"
                    event["object_id"] = query_result_id

                self.record_event(event)

            response_builders = {
                "json": self.make_json_response,
                "xlsx": self.make_excel_response,
                "csv": self.make_csv_response,
                "tsv": self.make_tsv_response,
            }
            response = response_builders[filetype](query_result)

            if len(settings.ACCESS_CONTROL_ALLOW_ORIGIN) > 0:
                self.add_cors_headers(response.headers)

            if should_cache:
                response.headers.add_header("Cache-Control", "private,max-age=%d" % ONE_YEAR)

            filename = get_download_filename(query_result, query, filetype)

            filenames = content_disposition_filenames(filename)
            response.headers.add("Content-Disposition", "attachment", **filenames)

            return response

        else:
            abort(404, message="未找到此查询的缓存结果。")

    @staticmethod
    def make_json_response(query_result):
        data = json_dumps({"query_result": query_result.to_dict()})
        headers = {"Content-Type": "application/json"}
        return make_response(data, 200, headers)

    @staticmethod
    def make_csv_response(query_result):
        headers = {"Content-Type": "text/csv; charset=UTF-8"}
        return make_response(serialize_query_result_to_dsv(query_result, ","), 200, headers)

    @staticmethod
    def make_tsv_response(query_result):
        headers = {"Content-Type": "text/tab-separated-values; charset=UTF-8"}
        return make_response(serialize_query_result_to_dsv(query_result, "\t"), 200, headers)

    @staticmethod
    def make_excel_response(query_result):
        headers = {"Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"}
        return make_response(serialize_query_result_to_xlsx(query_result), 200, headers)


class JobResource(BaseResource):
    def get(self, job_id, query_id=None):
        """
        获取正在运行的查询作业的信息。
        """
        job = Job.fetch(job_id)
        return serialize_job(job)

    def delete(self, job_id):
        """
        取消正在运行的查询作业。
        """
        job = Job.fetch(job_id)
        job.cancel()
