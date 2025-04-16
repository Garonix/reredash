import React from "react";
import PropTypes from "prop-types";
import Tooltip from "@/components/Tooltip";
import PlainButton from "@/components/PlainButton";
import { localizeTime, durationHumanize } from "@/lib/utils";
import { RefreshScheduleType, RefreshScheduleDefault } from "../proptypes";

import "./ScheduleDialog.css";

// 汉化英文单位
function zhDuration(str) {
  return str
    .replace(/(\d+) minutes?/g, '$1分钟')
    .replace(/(\d+) hours?/g, '$1小时')
    .replace(/(\d+) days?/g, '$1天')
    .replace(/(\d+) weeks?/g, '$1周')
    .replace(/(\d+) seconds?/g, '$1秒')
    .replace(/\bminute\b/, '1分钟')
    .replace(/\bhour\b/, '1小时')
    .replace(/\bday\b/, '1天')
    .replace(/\bweek\b/, '1周')
    .replace(/\bsecond\b/, '1秒');
}

export default class SchedulePhrase extends React.Component {
  static propTypes = {
    schedule: RefreshScheduleType,
    isNew: PropTypes.bool.isRequired,
    isLink: PropTypes.bool,
    onClick: PropTypes.func,
  };

  static defaultProps = {
    schedule: RefreshScheduleDefault,
    isLink: false,
    onClick: () => {},
  };

  get content() {
    const { interval: seconds } = this.props.schedule || SchedulePhrase.defaultProps.schedule;
    if (!seconds) {
      return ["永不"];
    }
    const humanized = zhDuration(durationHumanize(seconds, {
      omitSingleValueNumber: true,
    }));
    const short = `每${humanized}`;
    let full = `每${humanized}刷新`;

    const { time, day_of_week: dayOfWeek } = this.props.schedule;
    if (time) {
      full += `，时间 ${localizeTime(time)}`;
    }
    if (dayOfWeek) {
      full += `，星期${dayOfWeek}`;
    }

    return [short, full];
  }

  render() {
    if (this.props.isNew) {
      return "永不";
    }

    const [short, full] = this.content;
    const content = full ? <Tooltip title={full}>{short}</Tooltip> : short;

    return this.props.isLink ? (
      <PlainButton type="link" className="schedule-phrase" onClick={this.props.onClick} data-test="EditSchedule">
        {content}
      </PlainButton>
    ) : (
      content
    );
  }
}
