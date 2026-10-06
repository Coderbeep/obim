import { toMediaUrl } from "@shared/pathUtils";

export const isRemoteImageSource = (source: string) => /^(?:https?:|data:image\/|blob:)/i.test(source);
export const imageSourceUrl = (source: string) => (isRemoteImageSource(source) ? source : toMediaUrl(source));
