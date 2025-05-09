import { isArray, isObject, isString, isFunction, startsWith, reduce, merge, map, each, isNil } from "lodash";
import resizeObserver from "@/services/resizeObserver";
import { Plotly, prepareData, prepareLayout, updateData, updateAxes, updateChartSize } from "../plotly";
import { formatSimpleTemplate } from "@/lib/value-format";
import moment from "moment";

const navigateToUrl = (url: string, shouldOpenNewTab: boolean = true) =>
  shouldOpenNewTab
    ? window.open(url, "_blank")
    : window.location.href = url;

function createErrorHandler(errorHandler: any) {
  return (error: any) => {
    // This error happens only when chart width is 20px and looks that
    // it's safe to just ignore it: 1px less or more and chart will get fixed.
    if (isString(error) && startsWith(error, "ax.dtick error")) {
      return;
    }
    errorHandler(error);
  };
}

// This utility is intended to reduce amount of plot updates when multiple Plotly.relayout
// calls needed in order to compute/update the plot.
// `.append()` method takes an array of two element: first one is a object with updates for layout,
// and second is an optional function that will be called when plot is updated. That function may
// return an array with same structure if further updates needed.
// `.process()` merges all updates into a single object and calls `Plotly.relayout()`. After that
// it calls all callbacks, collects their return values and does another loop if needed.
function initPlotUpdater() {
  let actions: any = [];

  const updater = {
    append(action: any) {
      if (isArray(action) && isObject(action[0])) {
        actions.push(action);
      }
      return updater;
    },
    // @ts-expect-error ts-migrate(7023) FIXME: 'process' implicitly has return type 'any' because... Remove this comment to see the full error message
    process(plotlyElement: any) {
      if (actions.length > 0) {
        const updates = reduce(actions, (updates, action) => merge(updates, action[0]), {});
        const handlers = map(actions, action => (isFunction(action[1]) ? action[1] : () => null));
        actions = [];
        return Plotly.relayout(plotlyElement, updates).then(() => {
          each(handlers, handler => updater.append(handler()));
          return updater.process(plotlyElement);
        });
      } else {
        return Promise.resolve();
      }
    },
  };

  return updater;
}

export default function initChart(container: any, options: any, data: any, additionalOptions: any, onError: any) {
  const handleError = createErrorHandler(onError);

  const plotlyOptions = {
    showLink: false,
    displaylogo: false,
  };

  if (additionalOptions.hidePlotlyModeBar) {
    // @ts-expect-error ts-migrate(2339) FIXME: Property 'displayModeBar' does not exist on type '... Remove this comment to see the full error message
    plotlyOptions.displayModeBar = false;
  }

  const plotlyData = prepareData(data, options);
  const plotlyLayout = prepareLayout(container, options, plotlyData);

  // 修改padding
  // plotlyLayout.margin = {
  //   ...(plotlyLayout.margin || {}),
  //   l: 10, // 左侧padding
  //   r: 10, // 右侧padding
  // };

  const xValues = plotlyData[0]?.x || [];
  if (xValues.length > 0) {
    plotlyLayout.xaxis = {
      ...(plotlyLayout.xaxis || {}),
      range: [xValues[0], xValues[xValues.length - 1]], // 让x轴严格贴合数据
    };
  }

  let isDestroyed = false;

  let updater = initPlotUpdater();

  function createSafeFunction(fn: any) {
    // @ts-expect-error ts-migrate(7019) FIXME: Rest parameter 'args' implicitly has an 'any[]' ty... Remove this comment to see the full error message
    return (...args) => {
      if (!isDestroyed) {
        try {
          return fn(...args);
        } catch (error) {
          handleError(error);
        }
      }
    };
  }

  let unwatchResize = () => {};

  const promise = Promise.resolve()
    .then(() => Plotly.newPlot(container, plotlyData, plotlyLayout, plotlyOptions))
    .then(
      createSafeFunction(() =>
        updater
          .append(updateAxes(container, plotlyData, plotlyLayout, options))
          .append(updateChartSize(container, plotlyLayout, options))
          .process(container)
      )
    )
    .then(
      createSafeFunction(() => {
        container.on(
          "plotly_restyle",
          createSafeFunction((updates: any) => {
            // This event is triggered if some plotly data/layout has changed.
            // We need to catch only changes of traces visibility to update stacking
            // @ts-expect-error ts-migrate(2339) FIXME: Property 'visible' does not exist on type 'object'... Remove this comment to see the full error message
            if (isArray(updates) && isObject(updates[0]) && updates[0].visible) {
              updateData(plotlyData, options);
              updater.append(updateAxes(container, plotlyData, plotlyLayout, options)).process(container);
            }
          })
        );
        container.on(
          "plotly_relayout",
          createSafeFunction((event: any) => {
            // 只要有x轴范围，统一转为ISO字符串传递
            if (event && (event["xaxis.range[0]"] !== undefined || event["xaxis.range[1]"] !== undefined)) {
              const startISO = event["xaxis.range[0]"] ? moment(event["xaxis.range[0]"], "YYYY-MM-DD HH:mm:ss").toISOString() : undefined;
              const endISO = event["xaxis.range[1]"] ? moment(event["xaxis.range[1]"], "YYYY-MM-DD HH:mm:ss").toISOString() : undefined;
              console.log("[Plotly] x轴范围:", startISO, endISO);
              if (typeof window.onXAxisRangeChange === 'function') {
                window.onXAxisRangeChange(startISO, endISO);
              }
            }
          })
        );
        options.onHover && container.on("plotly_hover", options.onHover);
        options.onUnHover && container.on("plotly_unhover", options.onUnHover);
        container.on('plotly_click',
          createSafeFunction((data: any) => {
            if (options.enableLink === true) {
              try {
                var templateValues: { [k: string]: any } = {}
                data.points.forEach((point: any, i: number) => {
                  var sourceDataElement = [...point.data?.sourceData?.entries()][point.pointNumber ?? 0]?.[1]?.row ?? {};

                  if (isNil(templateValues['@@x'])) templateValues['@@x'] = sourceDataElement.x;
                  if (isNil(templateValues['@@y'])) templateValues['@@y'] = sourceDataElement.y;

                  templateValues[`@@y${i + 1}`] = sourceDataElement.y;
                  templateValues[`@@x${i + 1}`] = sourceDataElement.x;
                })
                navigateToUrl(
                  formatSimpleTemplate(options.linkFormat, templateValues).replace(/{{\s*([^\s]+?)\s*}}/g, () => ''),
                  options.linkOpenNewTab);
              } catch (error) {
                console.error('Click error: [%s]', error.message, { error });
              }
            }
          }));
        unwatchResize = resizeObserver(
          container,
          createSafeFunction(() => {
            updater.append(updateChartSize(container, plotlyLayout, options)).process(container);
          })
        );
      })
    )
    .catch(handleError);

  // @ts-expect-error ts-migrate(7022) FIXME: 'result' implicitly has type 'any' because it does... Remove this comment to see the full error message
  const result = {
    initialized: promise.then(() => result),
    setZoomEnabled: createSafeFunction((allowZoom: any) => {
      const layoutUpdates = { dragmode: allowZoom ? "zoom" : false };
      // @ts-expect-error ts-migrate(2345) FIXME: Argument of type '{ dragmode: string | boolean; }'... Remove this comment to see the full error message
      return Plotly.relayout(container, layoutUpdates);
    }),
    destroy: createSafeFunction(() => {
      isDestroyed = true;
      container.removeAllListeners("plotly_restyle");
      unwatchResize();
      delete container.__previousSize; // added by `updateChartSize`
      Plotly.purge(container);
    }),
  };

  return result;
}
