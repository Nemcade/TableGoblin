exports.selectPreset = async (page, kind, name) => {
  const details = page.locator(".preset-control").filter({ has: page.getByText(`${kind} presets`, { exact: true }) });
  if (!(await details.getAttribute("open"))) { // Boolean attributes have an empty value when open.
    if (!(await details.evaluate((el) => el.open))) await details.locator("summary").click();
  }
  await page.getByRole("combobox", { name: `${kind} preset`, exact: true }).selectOption({ label: name });
  const dialog = page.getByRole("alertdialog", { name: `${kind} preset decision`, exact: true });
  if (await dialog.count()) await dialog.getByRole("button", { name: "Overwrite", exact: true }).click();
};
exports.basicMood = (page) => exports.selectPreset(page, "Theme", "Basic green");
