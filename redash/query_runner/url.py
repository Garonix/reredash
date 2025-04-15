"""
URL查询运行器(已弃用)

该文件实现了一个简单的URL查询运行器，主要特性包括:
1. 继承自BaseHTTPQueryRunner
2. 支持相对URL和绝对URL访问
3. 标记为@deprecated，建议使用其他替代方案
4. 返回原始HTTP响应内容
"""

from redash.query_runner import BaseHTTPQueryRunner, register
from redash.utils import deprecated


@deprecated()
class Url(BaseHTTPQueryRunner):
    requires_url = False

    def test_connection(self):
        pass

    def run_query(self, query, user):
        base_url = self.configuration.get("url", None)

        query = query.strip()

        if base_url is not None and base_url != "":
            if query.find("://") > -1:
                return None, "Accepting only relative URLs to '%s'" % base_url

        if base_url is None:
            base_url = ""

        url = base_url + query

        response, error = self.get_response(url)
        if error is not None:
            return None, error

        json_data = response.content.strip()

        if json_data:
            return json_data, None
        else:
            return None, "Got empty response from '{}'.".format(url)


register(Url)
