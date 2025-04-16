import React from "react";
import ReactDOM from "react-dom";

import "@/config";
import ApplicationArea from "@/components/ApplicationArea";
import offlineListener from "@/services/offline-listener";
import moment from "moment";
import "moment/locale/zh-cn";
moment.locale("zh-cn");

ReactDOM.render(<ApplicationArea />, document.getElementById("application-root"), () => {
  offlineListener.init();
});
