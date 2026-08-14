export const EXIT_OK = 0;
export const EXIT_FAILED = 1;
export const EXIT_USAGE = 2;
export const EXIT_ENVIRONMENT = 3;
export const EXIT_CAPTURE_ERROR = 4;
export const EXIT_WRITE_ERROR = 5;
export const EXIT_PUBLISH_ERROR = 6;

export type ExitCode =
  | typeof EXIT_OK
  | typeof EXIT_FAILED
  | typeof EXIT_USAGE
  | typeof EXIT_ENVIRONMENT
  | typeof EXIT_CAPTURE_ERROR
  | typeof EXIT_WRITE_ERROR
  | typeof EXIT_PUBLISH_ERROR;

export interface FailureExit {
  message: string;
  code: ExitCode;
}

export function publishFailure(artifactPath: string, error: Error): FailureExit {
  return {
    message: `wrote ${artifactPath}, but publish failed: ${error.message}`,
    code: EXIT_PUBLISH_ERROR,
  };
}
