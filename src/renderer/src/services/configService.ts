export const getAppConfig = async () => {
  try {
    const content = await window["config"].getConfig();
    return content;
  } catch {
    return {};
  }
};
