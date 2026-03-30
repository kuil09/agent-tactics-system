import { MicrobenchStatus } from "../contracts/enums.js";

export function hasPassingMicrobench(status: MicrobenchStatus): boolean {
  return status === MicrobenchStatus.Pass;
}
