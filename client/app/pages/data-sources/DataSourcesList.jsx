import { isEmpty, reject } from "lodash";
import React from "react";
import PropTypes from "prop-types";

import Button from "antd/lib/button";
import routeWithUserSession from "@/components/ApplicationArea/routeWithUserSession";
import navigateTo from "@/components/ApplicationArea/navigateTo";
import CardsList from "@/components/cards-list/CardsList";
import LoadingState from "@/components/items-list/components/LoadingState";
import CreateSourceDialog from "@/components/CreateSourceDialog";
import DynamicComponent, { registerComponent } from "@/components/DynamicComponent";
import helper from "@/components/dynamic-form/dynamicFormHelper";
import wrapSettingsTab from "@/components/SettingsWrapper";
import PlainButton from "@/components/PlainButton";

import DataSource, { IMG_ROOT } from "@/services/data-source";
import { policy } from "@/services/policy";
import recordEvent from "@/services/recordEvent";
import routes from "@/services/routes";

export function DataSourcesListComponent({ dataSources, onClickCreate }) {
  const items = dataSources.map(dataSource => ({
    title: dataSource.name,
    imgSrc: `${IMG_ROOT}/${dataSource.type}.png`,
    href: `data_sources/${dataSource.id}`,
  }));

  return isEmpty(dataSources) ? (
    <div className="text-center">
      暂无数据源
      {policy.isCreateDataSourceEnabled() && (
        <div className="m-t-5">
          <PlainButton type="link" onClick={onClickCreate} data-test="CreateDataSourceLink">
            点击这里
          </PlainButton>{" "}
          添加数据源
        </div>
      )}
    </div>
  ) : (
    <CardsList items={items} />
  );
}

registerComponent("DataSourcesListComponent", DataSourcesListComponent);

class DataSourcesList extends React.Component {
  static propTypes = {
    isNewDataSourcePage: PropTypes.bool,
    onError: PropTypes.func,
  };

  static defaultProps = {
    isNewDataSourcePage: false,
    onError: () => {},
  };

  state = {
    dataSourceTypes: [],
    dataSources: [],
    loading: true,
  };

  newDataSourceDialog = null;

  componentDidMount() {
    Promise.all([DataSource.query(), DataSource.types()])
      .then(values =>
        this.setState(
          {
            dataSources: values[0],
            dataSourceTypes: values[1],
            loading: false,
          },
          () => {
            // all resources are loaded in state
            if (this.props.isNewDataSourcePage) {
              if (policy.canCreateDataSource()) {
                this.showCreateSourceDialog();
              } else {
                navigateTo("data_sources", true);
              }
            }
          }
        )
      )
      .catch(error => this.props.onError(error));
  }

  componentWillUnmount() {
    if (this.newDataSourceDialog) {
      this.newDataSourceDialog.dismiss();
    }
  }

  createDataSource = (selectedType, values) => {
    const target = { options: {}, type: selectedType.type };
    helper.updateTargetWithValues(target, values);

    return DataSource.create(target).then(dataSource => {
      this.setState({ loading: true });
      DataSource.query().then(dataSources => this.setState({ dataSources, loading: false }));
      return dataSource;
    });
  };

  showCreateSourceDialog = () => {
    recordEvent("view", "page", "data_sources/new");
    this.newDataSourceDialog = CreateSourceDialog.showModal({
      types: reject(this.state.dataSourceTypes, "deprecated"),
      sourceType: "Data Source",
      imageFolder: IMG_ROOT,
      helpTriggerPrefix: "DS_",
      onCreate: this.createDataSource,
    });

    this.newDataSourceDialog
      .onClose((result = {}) => {
        this.newDataSourceDialog = null;
        if (result.success) {
          navigateTo(`data_sources/${result.data.id}`);
        }
      })
      .onDismiss(() => {
        this.newDataSourceDialog = null;
        navigateTo("data_sources", true);
      });
  };

  render() {
    const newDataSourceProps = {
      type: "primary",
      onClick: policy.isCreateDataSourceEnabled() ? this.showCreateSourceDialog : null,
      disabled: !policy.isCreateDataSourceEnabled(),
      "data-test": "CreateDataSourceButton",
    };

    return (
      <div>
        <div className="m-b-15">
          <Button {...newDataSourceProps}>
            <i className="fa fa-plus m-r-5" aria-hidden="true" />
            新建数据源
          </Button>
          <DynamicComponent name="DataSourcesListExtra" />
        </div>
        {this.state.loading ? (
          <LoadingState className="" />
        ) : (
          <DynamicComponent
            name="DataSourcesListComponent"
            dataSources={this.state.dataSources}
            onClickCreate={this.showCreateSourceDialog}
          />
        )}
      </div>
    );
  }
}

const DataSourcesListPage = wrapSettingsTab(
  "DataSources.List",
  {
    permission: "admin",
    title: "数据源",
    path: "data_sources",
    order: 1,
  },
  DataSourcesList
);

routes.register(
  "DataSources.List",
  routeWithUserSession({
    path: "/data_sources",
    title: "数据源",
    render: pageProps => <DataSourcesListPage {...pageProps} />,
  })
);
routes.register(
  "DataSources.New",
  routeWithUserSession({
    path: "/data_sources/new",
    title: "数据源",
    render: pageProps => <DataSourcesListPage {...pageProps} isNewDataSourcePage />,
  })
);
