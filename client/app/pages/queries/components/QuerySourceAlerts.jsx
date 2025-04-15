import React from "react";
import PropTypes from "prop-types";
import Card from "antd/lib/card";
import WarningFilledIcon from "@ant-design/icons/WarningFilled";
import Typography from "antd/lib/typography";
import Link from "@/components/Link";
import DynamicComponent from "@/components/DynamicComponent";
import { currentUser } from "@/services/auth";

import useQueryFlags from "../hooks/useQueryFlags";
import "./QuerySourceAlerts.less";

export default function QuerySourceAlerts({ query, dataSourcesAvailable }) {
  const queryFlags = useQueryFlags(query); // we don't use flags that depend on data source

  let message = null;
  if (queryFlags.isNew && !queryFlags.canCreate) {
    message = (
      <React.Fragment>
        <Typography.Title level={4}>
          你没有权限创建新的查询
        </Typography.Title>
        <p>
          <Typography.Text type="secondary">
            你可以浏览<Link href="queries">现有的查询</Link>，或者请求管理员添加权限
          </Typography.Text>
        </p>
      </React.Fragment>
    );
  } else if (!dataSourcesAvailable) {
    if (currentUser.isAdmin) {
      message = (
        <React.Fragment>
          <Typography.Title level={4}>
            没有数据源，或者没有权限访问数据源
          </Typography.Title>
          <p>
            <Typography.Text type="secondary">请先创建数据源，然后开始查询</Typography.Text>
          </p>

          <div className="query-source-alerts-actions">
            <Link.Button type="primary" href="data_sources/new">
              创建数据源
            </Link.Button>
            <Link.Button type="default" href="groups">
              管理组权限
            </Link.Button>
          </div>
        </React.Fragment>
      );
    } else {
      message = (
        <React.Fragment>
          <Typography.Title level={4}>
            没有数据源，或者没有权限访问数据源
          </Typography.Title>
          <p>
            <Typography.Text type="secondary">请向管理员请求创建数据源</Typography.Text>
          </p>
        </React.Fragment>
      );
    }
  }

  if (!message) {
    return null;
  }

  return (
    <div className="query-source-alerts">
      <Card>
        <DynamicComponent name="QuerySource.Alerts" query={query} dataSourcesAvailable={dataSourcesAvailable}>
          <div className="query-source-alerts-icon">
            <WarningFilledIcon />
          </div>
          {message}
        </DynamicComponent>
      </Card>
    </div>
  );
}

QuerySourceAlerts.propTypes = {
  query: PropTypes.object.isRequired,
  dataSourcesAvailable: PropTypes.bool,
};

QuerySourceAlerts.defaultProps = {
  dataSourcesAvailable: false,
};
