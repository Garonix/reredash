import settingsMenu from "./settingsMenu";

const dataSourcesItem = {
  permission: "admin",
  title: "数据源",
  path: "data_sources",
};

const usersItem = {
  title: "用户",
  path: "users",
};

settingsMenu.add(null, dataSourcesItem);
settingsMenu.add(null, usersItem);

describe("SettingsMenu", () => {
  describe("isActive", () => {
    test("works with non multi org paths", () => {
      expect(settingsMenu.getActiveItem("/data_sources/").title).toBe(dataSourcesItem.title);
    });

    test("works with multi org paths", () => {
      // Set base href:
      const base = document.createElement("base");
      base.setAttribute("href", "http://localhost/acme/");
      document.head.appendChild(base);

      expect(settingsMenu.getActiveItem("/acme/data_sources/")).toBeTruthy();
      expect(settingsMenu.getActiveItem("/acme/data_sources/").title).toBe(dataSourcesItem.title);
    });
  });
});
