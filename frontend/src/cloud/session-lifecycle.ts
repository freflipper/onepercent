/** Orders asynchronous auth events and revokes the private UI before changing owners. */
export function createSessionLifecycle<T extends { user: { id: string } }>(
  clear: (userId?: string) => Promise<void>,
  publish: (session: T | null, loading: boolean) => void,
) {
  let revision = 0;
  let owner: string | undefined;
  let tail: Promise<void> = Promise.resolve();
  let disposed = false;
  const current = (ticket: number) => !disposed && ticket === revision;
  function begin(hide = true) {
    const ticket = ++revision;
    if (!disposed && hide) publish(null, true);
    return ticket;
  }
  function apply(session: T | null, ticket: number) {
    const operation = tail
      .catch(() => {})
      .then(async () => {
        if (!current(ticket)) return;
        // Preserve the signed-in user's emergency drafts during a normal cold start.
        if ((owner && owner !== session?.user.id) || !session) await clear(owner);
        if (!current(ticket)) return;
        owner = session?.user.id;
        publish(session, false);
      });
    tail = operation;
    return operation;
  }
  return {
    begin,
    apply,
    current,
    transition(session: T | null) {
      return apply(session, begin(owner !== session?.user.id));
    },
    fail(ticket: number) {
      if (current(ticket)) publish(null, false);
    },
    dispose() {
      disposed = true;
      revision++;
    },
    activate() {
      disposed = false;
    },
    owner: () => owner,
  };
}
