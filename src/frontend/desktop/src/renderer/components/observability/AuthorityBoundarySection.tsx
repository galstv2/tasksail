type AuthorityBoundarySectionProps = {
  message: string;
  policyBoundary: string;
};

function AuthorityBoundarySection({ message, policyBoundary }: AuthorityBoundarySectionProps): JSX.Element {
  return (
    <section className="obs-section">
      <h3 className="obs-section__title">Permissions</h3>
      <p className="obs-section__desc">
        The rules that control what agents can and cannot do — like which files they can change and which actions are off limits.
      </p>
      {message && <p className="obs-section__body">{message}</p>}
      {policyBoundary && <p className="obs-section__body">{policyBoundary}</p>}
    </section>
  );
}

export default AuthorityBoundarySection;
