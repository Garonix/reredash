/*
 * CreateSourceDialog组件 - 用于创建新数据源的对话框
 * 主要功能：
 * - 提供数据源类型选择界面
 * - 处理数据源配置表单
 * - 实现数据源创建流程
 * - 支持搜索筛选数据源类型
 */

import React from "react";
import PropTypes from "prop-types";
import { isEmpty, toUpper, includes, get, uniqueId } from "lodash";
import Button from "antd/lib/button";
import List from "antd/lib/list";
import Modal from "antd/lib/modal";
import Input from "antd/lib/input";
import Steps from "antd/lib/steps";
import { wrap as wrapDialog, DialogPropType } from "@/components/DialogWrapper";
import Link from "@/components/Link";
import { PreviewCard } from "@/components/PreviewCard";
import EmptyState from "@/components/items-list/components/EmptyState";
import DynamicForm from "@/components/dynamic-form/DynamicForm";
import helper from "@/components/dynamic-form/dynamicFormHelper";
import HelpTrigger, { TYPES as HELP_TRIGGER_TYPES } from "@/components/HelpTrigger";

const { Step } = Steps;
const { Search } = Input;

const StepEnum = {
  SELECT_TYPE: 0,
  CONFIGURE_IT: 1,
  DONE: 2,
};

class CreateSourceDialog extends React.Component {
  static propTypes = {
    dialog: DialogPropType.isRequired,
    types: PropTypes.arrayOf(PropTypes.object),
    sourceType: PropTypes.string.isRequired,
    imageFolder: PropTypes.string.isRequired,
    helpTriggerPrefix: PropTypes.string,
    onCreate: PropTypes.func.isRequired,
  };

  static defaultProps = {
    types: [],
    helpTriggerPrefix: null,
  };

  state = {
    searchText: "",
    selectedType: null,
    savingSource: false,
    currentStep: StepEnum.SELECT_TYPE,
  };

  formId = uniqueId("sourceForm");

  selectType = selectedType => {
    this.setState({ selectedType, currentStep: StepEnum.CONFIGURE_IT });
  };

  resetType = () => {
    if (this.state.currentStep === StepEnum.CONFIGURE_IT) {
      this.setState({ searchText: "", selectedType: null, currentStep: StepEnum.SELECT_TYPE });
    }
  };

  createSource = (values, successCallback, errorCallback) => {
    const { selectedType, savingSource } = this.state;
    if (!savingSource) {
      this.setState({ savingSource: true, currentStep: StepEnum.DONE });
      this.props
        .onCreate(selectedType, values)
        .then(data => {
          successCallback("Saved.");
          this.props.dialog.close({ success: true, data });
        })
        .catch(error => {
          this.setState({ savingSource: false, currentStep: StepEnum.CONFIGURE_IT });
          errorCallback(get(error, "response.data.message", "保存失败."));
        });
    }
  };

  renderTypeSelector() {
    const { types } = this.props;
    const { searchText } = this.state;
    const filteredTypes = types.filter(
      type => isEmpty(searchText) || includes(type.name.toLowerCase(), searchText.toLowerCase())
    );
    return (
      <div className="m-t-10">
        <Search
          placeholder="Search..."
          aria-label="Search"
          onChange={e => this.setState({ searchText: e.target.value })}
          autoFocus
          data-test="SearchSource"
        />
        <div className="scrollbox p-5 m-t-10" style={{ minHeight: "30vh", maxHeight: "40vh" }}>
          {isEmpty(filteredTypes) ? (
            <EmptyState className="" />
          ) : (
            <List size="small" dataSource={filteredTypes} renderItem={item => this.renderItem(item)} />
          )}
        </div>
      </div>
    );
  }

  renderForm() {
    const { imageFolder, helpTriggerPrefix } = this.props;
    const { selectedType } = this.state;
    const fields = helper.getFields(selectedType);
    const helpTriggerType = `${helpTriggerPrefix}${toUpper(selectedType.type)}`;
    return (
      <div>
        <div className="d-flex justify-content-center align-items-center">
          <img className="p-5" src={`${imageFolder}/${selectedType.type}.png`} alt={selectedType.name} width="48" />
          <h4 className="m-0">{selectedType.name}</h4>
        </div>
        <div className="text-right">
          {HELP_TRIGGER_TYPES[helpTriggerType] && (
            <HelpTrigger className="f-13" type={helpTriggerType}>
              Setup Instructions <i className="fa fa-question-circle" aria-hidden="true" />
              <span className="sr-only">(help)</span>
            </HelpTrigger>
          )}
        </div>
        <DynamicForm id={this.formId} fields={fields} onSubmit={this.createSource} feedbackIcons hideSubmitButton />
        {selectedType.type === "databricks" && (
          <small>
            By using the Databricks Data Source you agree to the Databricks JDBC/ODBC{" "}
            <Link href="https://databricks.com/spark/odbc-driver-download" target="_blank" rel="noopener noreferrer">
              Driver Download Terms and Conditions
            </Link>
            .
          </small>
        )}
      </div>
    );
  }

  renderItem(item) {
    const { imageFolder } = this.props;
    return (
      <List.Item className="p-l-10 p-r-10 clickable" onClick={() => this.selectType(item)}>
        <PreviewCard
          title={item.name}
          imageUrl={`${imageFolder}/${item.type}.png`}
          roundedImage={false}
          data-test="PreviewItem"
          data-test-type={item.type}>
          <i className="fa fa-angle-double-right" aria-hidden="true" />
        </PreviewCard>
      </List.Item>
    );
  }

  componentDidMount() {
    const { types } = this.props;
    if (types.length === 1 && types[0].type === "prometheus") {
      this.setState({
        selectedType: types[0],
        currentStep: StepEnum.CONFIGURE_IT,
      });
    }
  }

  render() {
    const { currentStep, savingSource } = this.state;
    const { dialog, types } = this.props;
    return (
      <Modal
        {...dialog.props}
        title={`创建新的数据源`}
        footer={
          currentStep === StepEnum.SELECT_TYPE && types.length > 1
            ? [
                <Button key="cancel" onClick={() => dialog.dismiss()} data-test="CreateSourceCancelButton">
                  取消
                </Button>,
                <Button key="submit" type="primary" disabled>
                  创建
                </Button>,
              ]
            : [
                <Button key="previous" onClick={this.resetType} style={{ display: types.length > 1 ? undefined : "none" }}>
                  上一步
                </Button>,
                <Button
                  key="submit"
                  htmlType="submit"
                  form={this.formId}
                  type="primary"
                  loading={savingSource}
                  data-test="CreateSourceSaveButton">
                  创建
                </Button>,
              ]
        }>
        <div data-test="CreateSourceDialog">
          <Steps className="hidden-xs m-b-10" size="small" current={currentStep} progressDot>
            {types.length > 1 && (
              currentStep === StepEnum.CONFIGURE_IT ? (
                <Step title={<a>选择数据源</a>} className="clickable" onClick={this.resetType} />
              ) : (
                <Step title="选择数据源" />
              )
            )}
            <Step title="配置" />
            <Step title="完成" />
          </Steps>
          {currentStep === StepEnum.SELECT_TYPE && types.length > 1 ? this.renderTypeSelector() : null}
          {currentStep === StepEnum.CONFIGURE_IT ? this.renderForm() : null}
        </div>
      </Modal>
    );
  }
}

export default wrapDialog(CreateSourceDialog);
