import { map, trim } from "lodash";
import React from "react";
import PropTypes from "prop-types";
import Tooltip from "@/components/Tooltip";
import EditTagsDialog from "./EditTagsDialog";
import PlainButton from "@/components/PlainButton";

export class TagsControl extends React.Component {
  static propTypes = {
    tags: PropTypes.arrayOf(PropTypes.string),
    canEdit: PropTypes.bool,
    getAvailableTags: PropTypes.func,
    onEdit: PropTypes.func,
    className: PropTypes.string,
    tagsExtra: PropTypes.node,
    tagSeparator: PropTypes.node,
    children: PropTypes.node,
  };

  static defaultProps = {
    tags: [],
    canEdit: false,
    getAvailableTags: () => Promise.resolve([]),
    onEdit: () => {},
    className: "",
    tagsExtra: null,
    tagSeparator: null,
    children: null,
  };

  editTags = (tags, getAvailableTags) => {
    EditTagsDialog.showModal({ tags, getAvailableTags }).onClose(this.props.onEdit);
  };

  renderEditButton() {
    const tags = map(this.props.tags, trim);
    return (
      <PlainButton
        className="label label-tag hidden-xs"
        onClick={() => this.editTags(tags, this.props.getAvailableTags)}
        data-test="EditTagsButton">
        {tags.length === 0 && (
          <React.Fragment>
            <i className="zmdi zmdi-plus m-r-5" aria-hidden="true" />
            添加标签
          </React.Fragment>
        )}
        {tags.length > 0 && (
          <>
            <i className="zmdi zmdi-edit" aria-hidden="true" />
            <span className="sr-only">编辑标签</span>
          </>
        )}
      </PlainButton>
    );
  }

  render() {
    const { tags, tagSeparator } = this.props;
    return (
      <div className={"tags-control " + this.props.className} data-test="TagsControl">
        {this.props.children}
        {map(tags, (tag, i) => (
          <React.Fragment key={tag}>
            {tagSeparator && i > 0 && <span className="tag-separator">{tagSeparator}</span>}
            <span className="label label-tag" key={tag} title={tag} data-test="TagLabel">
              {tag}
            </span>
          </React.Fragment>
        ))}
        {this.props.canEdit && this.renderEditButton()}
        {this.props.tagsExtra}
      </div>
    );
  }
}

function modelTagsControl({ archivedTooltip }) {
  // See comment for `propTypes`/`defaultProps`
  // eslint-disable-next-line react/prop-types
  function ModelTagsControl({ isDraft, isArchived, ...props }) {
    return (
      <TagsControl {...props}>
        {!isArchived && isDraft && <span className="label label-tag-unpublished">未发布</span>}
        {isArchived && (
          <Tooltip placement="right" title={archivedTooltip}>
            <span className="label label-tag-archived">已归档</span>
          </Tooltip>
        )}
      </TagsControl>
    );
  }

  ModelTagsControl.propTypes = {
    isDraft: PropTypes.bool,
    isArchived: PropTypes.bool,
  };

  ModelTagsControl.defaultProps = {
    isDraft: false,
    isArchived: false,
  };

  return ModelTagsControl;
}

export const QueryTagsControl = modelTagsControl({
  archivedTooltip: "此查询已归档，无法在仪表板中使用，也不会出现在搜索结果中。",
});

export const DashboardTagsControl = modelTagsControl({
  archivedTooltip: "此仪表板已归档，不会出现在仪表板列表或搜索结果中。",
});
