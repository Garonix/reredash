import React, { useState } from "react";
import PropTypes from "prop-types";
import Modal from "antd/lib/modal";
import DatePicker from "antd/lib/date-picker";
import TimePicker from "antd/lib/time-picker";
import Select from "antd/lib/select";
import Radio from "antd/lib/radio";
import { capitalize, clone, isEqual, omitBy, isNil, isEmpty } from "lodash";
import moment from "moment";
import { secondsToInterval, durationHumanize, pluralize, IntervalEnum, localizeTime } from "@/lib/utils";
import { wrap as wrapDialog, DialogPropType } from "@/components/DialogWrapper";
import { RefreshScheduleType, RefreshScheduleDefault, Moment } from "../proptypes";

import "./ScheduleDialog.css";

const WEEKDAYS_SHORT = moment.weekdaysShort();
const WEEKDAYS_FULL = moment.weekdays();
const DATE_FORMAT = "YYYY-MM-DD";
const HOUR_FORMAT = "HH:mm";
const { Option, OptGroup } = Select;

// 汉化时间单位标签
const INTERVAL_LABELS = {
  minutes: "分钟",
  hours: "小时",
  days: "天",
  weeks: "周",
};
// 汉化时间区间内容
function zhDuration(str) {
  return str
    .replace(/(\d+) minutes?/, "$1 分钟")
    .replace(/(\d+) hours?/, "$1 小时")
    .replace(/(\d+) days?/, "$1 天")
    .replace(/(\d+) weeks?/, "$1 周");
}

export function TimeEditor(props) {
  const [time, setTime] = useState(props.defaultValue);
  const showUtc = time && !time.isUTC();

  function onChange(newTime) {
    setTime(newTime);
    props.onChange(newTime);
  }

  return (
    <React.Fragment>
      <TimePicker allowClear={false} value={time} format={HOUR_FORMAT} minuteStep={5} onChange={onChange} />
      {showUtc && (
        <span className="utc" data-testid="utc">
          ({moment.utc(time).format(HOUR_FORMAT)} UTC)
        </span>
      )}
    </React.Fragment>
  );
}

TimeEditor.propTypes = {
  defaultValue: Moment,
  onChange: PropTypes.func.isRequired,
};

TimeEditor.defaultProps = {
  defaultValue: null,
};

class ScheduleDialog extends React.Component {
  static propTypes = {
    schedule: RefreshScheduleType,
    refreshOptions: PropTypes.arrayOf(PropTypes.number).isRequired,
    dialog: DialogPropType.isRequired,
  };

  static defaultProps = {
    schedule: RefreshScheduleDefault,
  };

  state = this.getState();

  getState() {
    const newSchedule = clone(this.props.schedule || ScheduleDialog.defaultProps.schedule);
    const { time, interval: seconds, day_of_week: day } = newSchedule;
    const { interval } = secondsToInterval(seconds);
    const [hour, minute] = time ? localizeTime(time).split(":") : [null, null];

    return {
      hour,
      minute,
      seconds,
      interval,
      dayOfWeek: day ? WEEKDAYS_SHORT[WEEKDAYS_FULL.indexOf(day)] : null,
      newSchedule,
    };
  }

  get intervals() {
    const ret = {
      [IntervalEnum.NEVER]: [],
    };
    this.props.refreshOptions.forEach(seconds => {
      const { count, interval } = secondsToInterval(seconds);
      if (!(interval in ret)) {
        ret[interval] = [];
      }
      ret[interval].push([count, seconds]);
    });

    Object.defineProperty(this, "intervals", { value: ret }); // memoize

    return ret;
  }

  set newSchedule(newProps) {
    this.setState(prevState => ({
      newSchedule: Object.assign(prevState.newSchedule, newProps),
    }));
  }

  setTime = time => {
    this.newSchedule = {
      time: moment(time)
        .utc()
        .format(HOUR_FORMAT),
    };
  };

  setInterval = newSeconds => {
    const { newSchedule } = this.state;
    const { interval: newInterval } = secondsToInterval(newSeconds);

    // resets to defaults
    if (newInterval === IntervalEnum.NEVER) {
      newSchedule.until = null;
    }
    if ([IntervalEnum.NEVER, IntervalEnum.MINUTES, IntervalEnum.HOURS].indexOf(newInterval) !== -1) {
      newSchedule.time = null;
    }
    if (newInterval !== IntervalEnum.WEEKS) {
      newSchedule.day_of_week = null;
    }
    if (
      (newInterval === IntervalEnum.DAYS || newInterval === IntervalEnum.WEEKS) &&
      (!this.state.minute || !this.state.hour)
    ) {
      newSchedule.time = moment()
        .hour("00")
        .minute("15")
        .utc()
        .format(HOUR_FORMAT);
    }
    if (newInterval === IntervalEnum.WEEKS && !this.state.dayOfWeek) {
      newSchedule.day_of_week = WEEKDAYS_FULL[0];
    }

    newSchedule.interval = newSeconds;

    const [hour, minute] = newSchedule.time ? localizeTime(newSchedule.time).split(":") : [null, null];

    this.setState({
      interval: newInterval,
      seconds: newSeconds,
      hour,
      minute,
      dayOfWeek: newSchedule.day_of_week ? WEEKDAYS_SHORT[WEEKDAYS_FULL.indexOf(newSchedule.day_of_week)] : null,
    });

    this.newSchedule = newSchedule;
  };

  setScheduleUntil = (_, date) => {
    this.newSchedule = { until: date };
  };

  setWeekday = e => {
    const dayOfWeek = e.target.value;
    this.setState({ dayOfWeek });
    this.newSchedule = {
      day_of_week: dayOfWeek ? WEEKDAYS_FULL[WEEKDAYS_SHORT.indexOf(dayOfWeek)] : null,
    };
  };

  setUntilToggle = e => {
    const date = e.target.value ? moment().format(DATE_FORMAT) : null;
    this.setScheduleUntil(null, date);
  };

  save() {
    const { newSchedule } = this.state;
    const hasChanged = () => {
      const newCompact = omitBy(newSchedule, isNil);
      const oldCompact = omitBy(this.props.schedule, isNil);
      return !isEqual(newCompact, oldCompact);
    };

    // save if changed
    if (hasChanged()) {
      if (newSchedule.interval) {
        this.props.dialog.close(clone(newSchedule));
      } else {
        this.props.dialog.close(null);
      }
    }
    this.props.dialog.dismiss();
  }

  render() {
    const { dialog } = this.props;
    const {
      interval,
      minute,
      hour,
      seconds,
      newSchedule: { until },
    } = this.state;

    return (
      <Modal {...dialog.props} title="刷新计划" className="schedule" onOk={() => this.save()}>
        <div className="schedule-component">
          <h5>刷新频率</h5>
          <div data-testid="interval">
            <Select className="input" value={seconds} onChange={this.setInterval} dropdownMatchSelectWidth={false}>
              <Option value={null} key="never">
                永不
              </Option>
              {Object.keys(this.intervals)
                .filter(int => !isEmpty(this.intervals[int]))
                .map(int => (
                  <OptGroup label={INTERVAL_LABELS[pluralize(int)] || capitalize(pluralize(int))} key={int}>
                    {this.intervals[int].map(([cnt, secs]) => (
                      <Option value={secs} key={`${int}-${cnt}`}>
                        {zhDuration(durationHumanize(secs))}
                      </Option>
                    ))}
                  </OptGroup>
                ))}
            </Select>
          </div>
        </div>
        {[IntervalEnum.DAYS, IntervalEnum.WEEKS].indexOf(interval) !== -1 ? (
          <div className="schedule-component">
            <h5>基于时间</h5>
            <div data-testid="time">
              <TimeEditor
                defaultValue={
                  hour
                    ? moment()
                        .hour(hour)
                        .minute(minute)
                    : null
                }
                onChange={this.setTime}
              />
            </div>
          </div>
        ) : null}
        {IntervalEnum.WEEKS === interval ? (
          <div className="schedule-component">
            <h5>基于星期几</h5>
            <div data-testid="weekday">
              <Radio.Group size="medium" defaultValue={this.state.dayOfWeek} onChange={this.setWeekday}>
                {WEEKDAYS_SHORT.map(day => (
                  <Radio.Button value={day} key={day} className="input">
                    {day[0]}
                  </Radio.Button>
                ))}
              </Radio.Group>
            </div>
          </div>
        ) : null}
        {interval !== IntervalEnum.NEVER ? (
          <div className="schedule-component">
            <h5>结束时间</h5>
            <div className="ends" data-testid="ends">
              <Radio.Group size="medium" value={!!until} onChange={this.setUntilToggle}>
                <Radio value={false}>永不结束</Radio>
                <Radio value>设定时间</Radio>
              </Radio.Group>
              {until ? (
                <DatePicker
                  size="small"
                  className="datepicker"
                  value={moment(until)}
                  allowClear={false}
                  format={DATE_FORMAT}
                  onChange={this.setScheduleUntil}
                />
              ) : null}
            </div>
          </div>
        ) : null}
      </Modal>
    );
  }
}

export default wrapDialog(ScheduleDialog);
