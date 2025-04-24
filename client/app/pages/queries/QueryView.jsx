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
  // -------------------- State & Hooks --------------------
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
  const [duration, setDuration] = useState("PT1H"); // 默认1小时
  const [endTime, setEndTime] = useState(moment().utc()); // 默认当前时间

  // -------------------- 查询执行相关 --------------------
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

  // -------------------- 业务逻辑 Hooks --------------------
  const updateQueryDescription = useUpdateQueryDescription(query, setQuery);
  const editSchedule = useEditScheduleDialog(query, setQuery);
  const addVisualization = useEditVisualizationDialog(query, queryResult, (newQuery, visualization) => {
    setQuery(newQuery);
    setSelectedVisualization(visualization.id);
  });
  const editVisualization = useEditVisualizationDialog(query, queryResult, newQuery => setQuery(newQuery));
  const deleteVisualization = useDeleteVisualization(query, setQuery);

  // -------------------- 查询执行封装 --------------------
  const doExecuteQuery = useCallback(
    (extraOptions = {}, skipParametersDirtyFlag = false) => {
      if (!queryFlags.canExecute || (!skipParametersDirtyFlag && (areParametersDirty || isExecuting))) {
        return;
      }
      executeQuery(0, undefined, extraOptions); // 新增参数透传
    },
    [areParametersDirty, executeQuery, isExecuting, queryFlags.canExecute]
  );

  // -------------------- 其他处理 --------------------
  useEffect(() => {
    document.title = query.name;
  }, [query.name]);

  useEffect(() => {
    DataSource.get({ id: query.data_source_id }).then(setDataSource);
  }, [query.data_source_id]);

  // -------------------- 参数与查询联动 --------------------
  function refreshParameters(durationValue, endValue) {
    // 每次刷新前，endTime 都取当前最新时间
    const endMoment = moment().utc();
    let startMoment = endMoment.clone().subtract(moment.duration(durationValue));
    setEndTime(endMoment); // 同步更新state
    doExecuteQuery({ start: startMoment.toISOString(), end: endMoment.toISOString() }, true);
  }

  function onDurationChange(value) {
    setDuration(value);
    refreshParameters(value, endTime);
  }
  function onEndTimeChange(value) {
    setEndTime(value);
    refreshParameters(duration, value);
  }

  // 参数变更处理
  function handleParametersChange(newParams) {
    updateParametersDirtyFlag(false);
    refreshParameters(newParams?.duration || duration, newParams?.endTime || endTime);
  }

  // -------------------- 渲染 --------------------
  return (
    <div
      className={cx("query-page-wrapper", {
        "query-view-fullscreen": fullscreen,
        "query-fixed-layout": isFixedLayout,
      })}
    >
      <div className="container w-100">
        <QueryPageHeader
          query={query}
          dataSource={dataSource}
          onChange={setQuery}
          selectedVisualization={selectedVisualization}
          parameters={parameters}
          onParametersChange={() => refreshParameters(duration, endTime)}
          headerExtra={
            <div style={{ display: "flex", gap: 8, alignItems: "center", marginRight: 12 }}>
              <Select value={duration} onChange={onDurationChange} style={{ width: 120 }} size="small">
                <Select.Option value="PT1M">1分钟</Select.Option>
                <Select.Option value="PT5M">5分钟</Select.Option>
                <Select.Option value="PT15M">15分钟</Select.Option>
                <Select.Option value="PT30M">30分钟</Select.Option>
                <Select.Option value="PT1H">1小时</Select.Option>
                <Select.Option value="PT2H">2小时</Select.Option>
                <Select.Option value="PT3H">3小时</Select.Option>
                <Select.Option value="PT6H">6小时</Select.Option>
                <Select.Option value="PT12H">12小时</Select.Option>
                <Select.Option value="P1D">1天</Select.Option>
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
                    onClick={() => refreshParameters(duration, endTime)}
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
              onValuesChange={handleParametersChange}
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
                    onClick={() => refreshParameters(duration, endTime)}
                  >
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
                    onClick={toggleFullscreen}
                  >
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
