type OnboardingProgressProps = {
  backHref: string;
  current: number;
  total: number;
};

export function OnboardingProgress({ backHref, current, total }: OnboardingProgressProps) {
  const safeTotal = Math.max(1, total);
  const safeCurrent = Math.min(Math.max(1, current), safeTotal);
  const progress = `${(safeCurrent / safeTotal) * 100}%`;

  return (
    <nav className="onboarding-progress" aria-label={`Onboarding step ${safeCurrent} of ${safeTotal}`}>
      <a className="onboarding-back" href={backHref} aria-label="Go back">&#8249;</a>
      <div
        className="progress-track"
        role="progressbar"
        aria-valuemin={1}
        aria-valuemax={safeTotal}
        aria-valuenow={safeCurrent}
      >
        <span className="progress-value" style={{ width: progress }} />
      </div>
    </nav>
  );
}
