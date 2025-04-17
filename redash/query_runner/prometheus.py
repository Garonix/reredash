"""
Prometheus查询运行器实现

该文件实现了Redash与Prometheus监控系统的集成，主要功能包括:
1. 支持即时查询(get_instant_rows)和范围查询(get_range_rows)
2. 提供Prometheus查询运行器类(Prometheus)，继承自BaseQueryRunner
   - 处理证书认证、时间范围转换、查询执行等
3. 支持Prometheus HTTP API的所有查询参数
4. 自动处理时间范围(now、时间戳转换等)
"""

import os
import time
from base64 import b64decode
from datetime import datetime, timedelta
from tempfile import NamedTemporaryFile
from urllib.parse import parse_qs

import requests
from dateutil import parser

from redash.query_runner import (
    TYPE_DATETIME,
    TYPE_STRING,
    BaseQueryRunner,
    register,
)


def get_instant_rows(metrics_data):
    """
    处理即时查询结果，将数据转换为行数据
    :param metrics_data: Prometheus API 返回的 metrics 数据
    :return: 行数据列表
    """
    rows = []

    for metric in metrics_data:
        row_data = metric["metric"]

        timestamp, value = metric["value"]
        date_time = datetime.fromtimestamp(timestamp)

        row_data.update({"timestamp": date_time, "value": value})
        rows.append(row_data)
    return rows


def get_range_rows(metrics_data):
    """
    处理范围查询结果，将数据转换为行数据
    :param metrics_data: Prometheus API 返回的 metrics 数据
    :return: 行数据列表
    """
    rows = []

    for metric in metrics_data:
        ts_values = metric["values"]
        metric_labels = metric["metric"]

        for values in ts_values:
            row_data = metric_labels.copy()

            timestamp, value = values
            date_time = datetime.fromtimestamp(timestamp)

            row_data.update({"timestamp": date_time, "value": value})
            rows.append(row_data)
    return rows


# 将 datetime 字符串转换为时间戳
def convert_query_range(payload):
    """
    转换查询参数中的时间范围，将 datetime 字符串转换为时间戳
    :param payload: 查询参数
    :return: None
    """
    query_range = {}

    for key in ["start", "end"]:
        if key not in payload.keys():
            continue
        value = payload[key][0]

        if isinstance(value, str):
            # 如果是时间戳字符串则不转换
            try:
                int(value)
                continue
            except ValueError:
                pass
            value = parser.parse(value)

        if type(value) is datetime:
            query_range[key] = [int(time.mktime(value.timetuple()))]

    payload.update(query_range)


class Prometheus(BaseQueryRunner):
    should_annotate_query = False

    def _get_datetime_now(self):
        """
        获取当前时间
        :return: 当前时间
        """
        return datetime.now()

    def _get_prometheus_kwargs(self):
        """
        获取 Prometheus 连接参数
        :return: Prometheus 连接参数
        """
        ca_cert_file = self._create_cert_file("ca_cert_File")
        if ca_cert_file is not None:
            verify = ca_cert_file
        else:
            verify = self.configuration.get("verify_ssl", True)

        cert_file = self._create_cert_file("cert_File")
        cert_key_file = self._create_cert_file("cert_key_File")
        if cert_file is not None and cert_key_file is not None:
            cert = (cert_file, cert_key_file)
        else:
            cert = ()

        return {
            "verify": verify,
            "cert": cert,
        }

    def _create_cert_file(self, key):
        """
        创建证书文件
        :param key: 证书配置 key
        :return: 证书文件名
        """
        cert_file_name = None

        if self.configuration.get(key, None) is not None:
            with NamedTemporaryFile(mode="w", delete=False) as cert_file:
                cert_bytes = b64decode(self.configuration[key])
                cert_file.write(cert_bytes.decode("utf-8"))
                cert_file_name = cert_file.name

        return cert_file_name

    def _cleanup_cert_files(self, promehteus_kwargs):
        """
        清理证书文件
        :param promehteus_kwargs: Prometheus 连接参数
        :return: None
        """
        verify = promehteus_kwargs.get("verify", True)
        if isinstance(verify, str) and os.path.exists(verify):
            os.remove(verify)

        cert = promehteus_kwargs.get("cert", ())
        for cert_file in cert:
            if os.path.exists(cert_file):
                os.remove(cert_file)

    @classmethod
    def configuration_schema(cls):
        """
        配置 schema
        :return: 配置 schema
        """
        # 文件名必须以 "File" 结尾
        return {
            "type": "object",
            "properties": {
                "url": {"type": "string", "title": "Prometheus API 地址"},
                "verify_ssl": {
                    "type": "boolean",
                    "title": "验证 SSL（如已提供根证书则忽略）",
                    "default": True,
                },
                "cert_File": {"type": "string", "title": "SSL 客户端证书", "default": None},
                "cert_key_File": {"type": "string", "title": "SSL 客户端密钥", "default": None},
                "ca_cert_File": {"type": "string", "title": "SSL 根证书", "default": None},
            },
            "required": ["url"],
            "secret": ["cert_File", "cert_key_File", "ca_cert_File"],
            "extra_options": ["verify_ssl", "cert_File", "cert_key_File", "ca_cert_File"],
        }

    def test_connection(self):
        """
        测试连接
        :return: 连接结果
        """
        result = False
        promehteus_kwargs = {}
        try:
            promehteus_kwargs = self._get_prometheus_kwargs()
            resp = requests.get(self.configuration.get("url", None), **promehteus_kwargs)
            result = resp.ok
        except Exception:
            raise
        finally:
            self._cleanup_cert_files(promehteus_kwargs)

        return result

    def get_schema(self, get_stats=False):
        """
        获取 schema
        :param get_stats: 是否获取统计信息
        :return: schema
        """
        schema = []
        promehteus_kwargs = {}
        try:
            base_url = self.configuration["url"]
            metrics_path = "/api/v1/label/__name__/values"
            promehteus_kwargs = self._get_prometheus_kwargs()

            response = requests.get(base_url + metrics_path, **promehteus_kwargs)

            response.raise_for_status()
            data = response.json()["data"]

            schema = {}
            for name in data:
                schema[name] = {"name": name, "columns": []}
            schema = list(schema.values())
        except Exception:
            raise
        finally:
            self._cleanup_cert_files(promehteus_kwargs)

        return schema

    def run_query(self, query, user):
        """
        运行查询
        :param query: 查询语句
        :param user: 用户信息
        :return: 查询结果
        """
        """
        查询语法，实际就是URL查询字符串。
        具体支持的查询参数请参考 Prometheus HTTP API 文档。

        https://prometheus.io/docs/prometheus/latest/querying/api/

        示例：即时查询
            query=http_requests_total

        示例：范围查询
            query=http_requests_total&start=2018-01-20T00:00:00.000Z&end=2018-01-25T00:00:00.000Z&step=60s

        示例：直到当前的范围查询
            query=http_requests_total&start=2018-01-20T00:00:00.000Z&step=60s
            query=http_requests_total&start=2018-01-20T00:00:00.000Z&end=now&step=60s
        """

        base_url = self.configuration["url"]
        columns = [
            {"friendly_name": "timestamp", "type": TYPE_DATETIME, "name": "timestamp"},
            {"friendly_name": "value", "type": TYPE_STRING, "name": "value"},
        ]
        promehteus_kwargs = {}
        print("DEBUG: run_query called")
        try:
            error = None
            # 为了兼容旧版本
            query = "query={}".format(query) if not query.startswith("query=") else query

            payload = parse_qs(query)
            # 根据 step 参数判断API端点类型
            query_type = "query_range" if "step" in payload.keys() else "query"

            # # 强制使用query_range
            # query_type = "query_range"
            # 如果没有end,则使用当前时间作为end
            if "end" not in payload.keys() or "now" in payload["end"]:
                date_now = self._get_datetime_now()
                payload.update({"end": [date_now]})

            # 如果没有start,则使用当前时间前1小时作为start
            if "start" not in payload.keys():
                date_now = self._get_datetime_now()
                payload.update({"start": [date_now - timedelta(hours=1)]})

            # 如果没有step,则使用1秒钟作为step
            if "step" not in payload.keys():
                payload.update({"step": ["1s"]})

            convert_query_range(payload)
            # 强制使用query_range查询
            api_endpoint = base_url + "/api/v1/query_range"

            promehteus_kwargs = self._get_prometheus_kwargs()

            response = requests.get(api_endpoint, params=payload, **promehteus_kwargs)
            response.raise_for_status()

            metrics = response.json()["data"]["result"]

            if len(metrics) == 0:
                return None, "查询结果为空."

            # 根据第一个metric结果结构判断如何解析数据行
            first_metric = metrics[0]
            if "values" in first_metric:
                # 结果包含时序数据（"values"）
                rows = get_range_rows(metrics)
            elif "value" in first_metric:
                # 结果包含单点数据（"value"）
                rows = get_instant_rows(metrics)
            else:
                # 如遇未知结果格式可在此处理
                return None, "未知的 Prometheus 结果格式。"

            # 从第一个metric中提取标签字段
            metric_labels = first_metric.get("metric", {}).keys()

            for label_name in metric_labels:
                columns.append(
                    {
                        "friendly_name": label_name,
                        "type": TYPE_STRING,
                        "name": label_name,
                    }
                )

            data = {"rows": rows, "columns": columns, "query_type": query_type}

        except requests.RequestException as e:
            return None, str(e)
        except Exception:
            raise
        finally:
            self._cleanup_cert_files(promehteus_kwargs)

        return data, error


register(Prometheus)
