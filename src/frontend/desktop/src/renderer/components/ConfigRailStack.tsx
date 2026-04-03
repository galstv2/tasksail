import type { ReactNode } from 'react';

type ConfigRailStackProps = {
  children: ReactNode;
};

function ConfigRailStack({ children }: ConfigRailStackProps): JSX.Element {
  return (
    <aside className="config-rail" aria-label="Configuration rail">
      {children}
    </aside>
  );
}

export default ConfigRailStack;
