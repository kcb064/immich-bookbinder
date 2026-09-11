export const WIZARD_STEPS = ['Source', 'Refine', 'Size & style', 'Review'] as const;

interface StepRailProps {
  /** Zero-based index of the current step. */
  current: number;
  steps?: readonly string[];
}

export function StepRail({ current, steps = WIZARD_STEPS }: StepRailProps) {
  return (
    <ol className="steps" aria-label="Steps" style={{ listStyle: 'none', margin: 0, padding: 0 }}>
      {steps.map((name, i) => {
        const state = i === current ? 'on' : i < current ? 'done' : 'todo';
        return (
          <li key={name} className={`step${state === 'on' ? ' step--on' : state === 'done' ? ' step--done' : ''}`} aria-current={state === 'on' ? 'step' : undefined}>
            <span className="step__num" aria-hidden="true">
              {i + 1}
            </span>
            <span className="step__name">{name}</span>
          </li>
        );
      })}
    </ol>
  );
}
