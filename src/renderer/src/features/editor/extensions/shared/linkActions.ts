export interface LinkActions {
  openResource(path: string): void | Promise<void>;
  openExternal(url: string): void | Promise<void>;
}

const ExternalLinkRegex = /^(?:https?:\/\/|www\.)\S+$/i;

export function isExternalLink(destination: string) {
  return ExternalLinkRegex.test(destination);
}

export function externalLinkUrl(destination: string) {
  return destination.startsWith("www.") ? `https://${destination}` : destination;
}

export function dispatchLinkDestination(destination: string, actions: LinkActions) {
  if (isExternalLink(destination)) {
    void actions.openExternal(externalLinkUrl(destination));
  } else {
    void actions.openResource(destination);
  }
}
