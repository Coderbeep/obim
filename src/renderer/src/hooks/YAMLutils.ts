// function that takes the YAML string and returns a list of lists [[key, value], [key-value]]
import yaml from "js-yaml";

export function parseYAML(YAMLContent) {
  try {
    const result = yaml.load(YAMLContent);
    return result;
  } catch (e) {
    console.error("Error parsing YAML content: ", e);
    return null;
  }
}
