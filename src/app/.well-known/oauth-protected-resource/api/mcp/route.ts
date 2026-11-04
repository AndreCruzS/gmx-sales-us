import { metadataOptions, protectedResourceMetadata } from "@/lib/mcp/metadata";

export const GET = (req: Request) => protectedResourceMetadata(req);
export const OPTIONS = () => metadataOptions();
