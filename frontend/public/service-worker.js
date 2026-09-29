/* Network-only worker: no fetch interception, cache, background timer or private data storage. */
self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  if (event.notification.data?.app !== 'onepercent') return;
  const inbox = new URL('notifications', self.registration.scope).href;
  event.waitUntil(
    (async () => {
      const clients = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
      const client = clients.find((client) => client.url.startsWith(self.registration.scope));
      if (client) {
        await client.navigate(inbox);
        await client.focus();
      } else await self.clients.openWindow(inbox);
    })(),
  );
});
