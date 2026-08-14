export interface LandingFacts {
  httpStatus: number | null;
  finalUrl: string;
  bodyText: string;
}

export interface LandingExpectations {
  allowStatus: boolean;
  expectText?: string;
}

export interface LandingVerdict {
  ok: boolean;
  reason?: string;
}

function isSuccessStatus(status: number): boolean {
  return status >= 200 && status < 400;
}

export function judgeLanding(facts: LandingFacts, expectations: LandingExpectations): LandingVerdict {
  let verdict: LandingVerdict = { ok: true };
  const statusRejected = !expectations.allowStatus && facts.httpStatus != null && !isSuccessStatus(facts.httpStatus);
  if (statusRejected) {
    verdict = {
      ok: false,
      reason: `page responded with HTTP ${facts.httpStatus}; pass --allow-status to capture it anyway`,
    };
  }
  const textMissing = verdict.ok && expectations.expectText != null && !facts.bodyText.includes(expectations.expectText);
  if (textMissing) {
    verdict = { ok: false, reason: `--expect-text "${expectations.expectText}" was not found on the page` };
  }
  return verdict;
}

export function assertLanding(facts: LandingFacts, expectations: LandingExpectations): void {
  const verdict = judgeLanding(facts, expectations);
  if (!verdict.ok) {
    throw new Error(verdict.reason);
  }
}
