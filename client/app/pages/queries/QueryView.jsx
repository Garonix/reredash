import React, { useState, useEffect, useCallback } from "react";
import PropTypes from "prop-types";
import cx from "classnames";
import useMedia from "use-media";
import Button from "antd/lib/button";
import Select from "antd/lib/select";
import DatePicker from "antd/lib/date-picker";
import moment from "moment";

import FullscreenOutlinedIcon from "@ant-design/icons/FullscreenOutlined";
import FullscreenExitOutlinedIcon from "@ant-design/icons/FullscreenExitOutlined";

import routeWithUserSession from "@/components/ApplicationArea/routeWithUserSession";
import EditInPlace from "@/components/EditInPlace";
import Parameters from "@/components/Parameters";
import DynamicComponent from "@/components/DynamicComponent";
import PlainButton from "@/components/PlainButton";

import DataSource from "@/services/data-source";
import { ExecutionStatus } from "@/services/query-result";
import routes from "@/services/routes";
import { policy } from "@/services/policy";

import useQueryResultData from "@/lib/useQueryResultData";

import QueryPageHeader from "./components/QueryPageHeader";
import QueryVisualizationTabs from "./components/QueryVisualizationTabs";
import QueryExecutionStatus from "./components/QueryExecutionStatus";
import QueryMetadata from "./components/QueryMetadata";
import wrapQueryPage from "./components/wrapQueryPage";
import QueryViewButton from "./components/QueryViewButton";
import QueryExecutionMetadata from "./components/QueryExecutionMetadata";

import useVisualizationTabHandler from "./hooks/useVisualizationTabHandler";
import useQueryExecute from "./hooks/useQueryExecute";
import useUpdateQueryDescription from "./hooks/useUpdateQueryDescription";
import useQueryFlags from "./hooks/useQueryFlags";
import useQueryParameters from "./hooks/useQueryParameters";
import useEditScheduleDialog from "./hooks/useEditScheduleDialog";
import useEditVisualizationDialog from "./hooks/useEditVisualizationDialog";
import useDeleteVisualization from "./hooks/useDeleteVisualization";
import useFullscreenHandler from "../../lib/hooks/useFullscreenHandler";

import "./QueryView.less";

function QueryView(props) {
  const [query, setQuery] = useState(props.query);
  const [dataSource, setDataSource] = useState();
  const queryFlags = useQueryFlags(query, dataSource);
  const [parameters, areParametersDirty, updateParametersDirtyFlag] = useQueryParameters(query);
  const [selectedVisualization, setSelectedVisualization] = useVisualizationTabHandler(query.visualizations);
  const isDesktop = useMedia({ minWidth: 768 });
  const isFixedLayout = useMedia({ minHeight: 500 }) && isDesktop;
  const [fullscreen, toggleFullscreen] = useFullscreenHandler(isDesktop);
  const [addingDescription, setAddingDescription] = useState(false);

  // 时间段和结束时间状态
  const [duration, setDuration] = useState("1h"); // 默认1小时
  const [endTime, setEndTime] = useState(moment()); // 默认当前时间

  // 参数变更处理
  function handleParametersChange(newParams) {
    updateParametersDirtyFlag(true);
    // 这里直接刷新查询
    doExecuteQuery();
  }

  // 控件变化后，生成新参数并触发 handleParametersChange
  function refreshParameters(durationValue, endValue) {
    const endMoment = endValue || moment();
    let startMoment = endMoment.clone().subtract(moment.duration(durationValue));
    handleParametersChange({
      ...parameters,
      start: startMoment.toISOString(),
      end: endMoment.toISOString(),
    });
  }

  function onDurationChange(value) {
    setDuration(value);
    refreshParameters(value, endTime);
  }
  function onEndTimeChange(value) {
    setEndTime(value);
    refreshParameters(duration, value);
  }

  const {
    queryResult,
    loadedInitialResults,
    isExecuting,
    executionStatus,
    executeQuery,
    error: executionError,
    cancelCallback: cancelExecution,
    isCancelling: isExecutionCancelling,
    updatedAt,
  } = useQueryExecute(query);

  const queryResultData = useQueryResultData(queryResult);

  const updateQueryDescription = useUpdateQueryDescription(query, setQuery);
  const editSchedule = useEditScheduleDialog(query, setQuery);
  const addVisualization = useEditVisualizationDialog(query, queryResult, (newQuery, visualization) => {
    setQuery(newQuery);
    setSelectedVisualization(visualization.id);
  });
  const editVisualization = useEditVisualizationDialog(query, queryResult, newQuery => setQuery(newQuery));
  const deleteVisualization = useDeleteVisualization(query, setQuery);

  const doExecuteQuery = useCallback(
    (skipParametersDirtyFlag = false) => {
      if (!queryFlags.canExecute || (!skipParametersDirtyFlag && (areParametersDirty || isExecuting))) {
        return;
      }
      executeQuery();
    },
    [areParametersDirty, executeQuery, isExecuting, queryFlags.canExecute]
  );

  useEffect(() => {
    document.title = query.name;
  }, [query.name]);

  useEffect(() => {
    DataSource.get({ id: query.data_source_id }).then(setDataSource);
  }, [query.data_source_id]);

  return (
    <div
      className={cx("query-page-wrapper", {
        "query-view-fullscreen": fullscreen,
        "query-fixed-layout": isFixedLayout,
      })}>
      <div className="container w-100">
        <QueryPageHeader
          query={query}
          dataSource={dataSource}
          onChange={setQuery}
          selectedVisualization={selectedVisualization}
          parameters={parameters}
          onParametersChange={handleParametersChange}
          headerExtra={
            <div style={{ display: "flex", gap: 8, alignItems: "center", marginRight: 12 }}>
              <Select value={duration} onChange={onDurationChange} style={{ width: 120 }} size="small">
                <Select.Option value="1m">1分钟</Select.Option>
                <Select.Option value="5m">5分钟</Select.Option>
                <Select.Option value="15m">15分钟</Select.Option>
                <Select.Option value="30m">30分钟</Select.Option>
                <Select.Option value="1h">1小时</Select.Option>
                <Select.Option value="6h">6小时</Select.Option>
                <Select.Option value="12h">12小时</Select.Option>
                <Select.Option value="24h">24小时</Select.Option>
              </Select>
              <DatePicker
                showTime
                value={endTime}
                onChange={onEndTimeChange}
                style={{ width: 180 }}
                size="small"
              />
              <DynamicComponent name="QueryView.HeaderExtra" query={query}>
                {policy.canRun(query) && (
                  <QueryViewButton
                    className="m-r-5"
                    type="primary"
                    shortcut="mod+enter, alt+enter, ctrl+enter"
                    disabled={!queryFlags.canExecute || isExecuting || areParametersDirty}
                    onClick={doExecuteQuery}
                  >
                    刷新
                  </QueryViewButton>
                )}
              </DynamicComponent>
            </div>
          }
          tagsExtra={
            !query.description &&
            queryFlags.canEdit &&
            !addingDescription &&
            !fullscreen && (
              <PlainButton className="label label-tag hidden-xs" role="none" onClick={() => setAddingDescription(true)}>
                <i className="zmdi zmdi-plus m-r-5" aria-hidden="true" />
                添加描述
              </PlainButton>
            )
          }
        />
        {(query.description || addingDescription) && (
          <div className={cx("m-t-5", { hidden: fullscreen })}>
            <EditInPlace
              className="w-100"
              value={query.description}
              isEditable={queryFlags.canEdit}
              onDone={updateQueryDescription}
              onStopEditing={() => setAddingDescription(false)}
              placeholder="添加描述"
              ignoreBlanks={false}
              editorProps={{ autoSize: { minRows: 2, maxRows: 4 } }}
              defaultEditing={addingDescription}
              multiline
            />
          </div>
        )}
      </div>
      <div className="query-view-content">
        {query.hasParameters() && (
          <div className={cx("bg-white tiled p-15 m-t-15 m-l-15 m-r-15", { hidden: fullscreen })}>
            <Parameters
              parameters={parameters}
              onValuesChange={() => {
                updateParametersDirtyFlag(false);
                doExecuteQuery(true);
              }}
              onPendingValuesChange={() => updateParametersDirtyFlag()}
            />
          </div>
        )}
        <div className="query-results m-t-15">
          {loadedInitialResults && (
            <QueryVisualizationTabs
              queryResult={queryResult}
              visualizations={query.visualizations}
              showNewVisualizationButton={queryFlags.canEdit && queryResultData.status === ExecutionStatus.DONE}
              canDeleteVisualizations={queryFlags.canEdit}
              selectedTab={selectedVisualization}
              onChangeTab={setSelectedVisualization}
              onAddVisualization={addVisualization}
              onDeleteVisualization={deleteVisualization}
              refreshButton={
                policy.canRun(query) && (
                  <Button
                    type="primary"
                    disabled={!queryFlags.canExecute || areParametersDirty}
                    loading={isExecuting}
                    onClick={doExecuteQuery}>
                    {!isExecuting && <i className="zmdi zmdi-refresh m-r-5" aria-hidden="true" />}
                    立即刷新
                  </Button>
                )
              }
              canRefresh={policy.canRun(query)}
            />
          )}
          <div className="query-results-footer">
            {queryResult && !queryResult.getError() && (
              <QueryExecutionMetadata
                query={query}
                queryResult={queryResult}
                selectedVisualization={selectedVisualization}
                isQueryExecuting={isExecuting}
                showEditVisualizationButton={queryFlags.canEdit}
                onEditVisualization={editVisualization}
                extraActions={
                  <QueryViewButton
                    className="icon-button m-r-5 hidden-xs"
                    title="切换全屏"
                    type="default"
                    shortcut="alt+f"
                    onClick={toggleFullscreen}>
                    {fullscreen ? <FullscreenExitOutlinedIcon /> : <FullscreenOutlinedIcon />}
                  </QueryViewButton>
                }
              />
            )}
            {(executionError || isExecuting) && (
              <div className="query-execution-status">
                <QueryExecutionStatus
                  status={executionStatus}
                  error={executionError}
                  isCancelling={isExecutionCancelling}
                  onCancel={cancelExecution}
                  updatedAt={updatedAt}
                />
              </div>
            )}
          </div>
        </div>
        <div className={cx("p-t-15 p-r-15 p-l-15", { hidden: fullscreen })}>
          <QueryMetadata layout="horizontal" query={query} dataSource={dataSource} onEditSchedule={editSchedule} />
        </div>
      </div>
    </div>
  );
}

QueryView.propTypes = { query: PropTypes.object.isRequired }; // eslint-disable-line react/forbid-prop-types

const QueryViewPage = wrapQueryPage(QueryView);

routes.register(
  "Queries.View",
  routeWithUserSession({
    path: "/queries/:queryId",
    render: pageProps => <QueryViewPage {...pageProps} />,
  })
);
