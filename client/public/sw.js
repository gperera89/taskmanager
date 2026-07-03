self.addEventListener("push", (event) => {
  let payload = { title: "Reminder", body: "", url: "/" };
  try {
    if (event.data) payload = { ...payload, ...event.data.json() };
  } catch {
    // Ignore malformed push payloads rather than crashing the service worker.
  }

  if (payload.close) {
    // A "close" push doesn't show anything new — it clears out a notification (matched by
    // tag) that's sat unactioned for an hour, e.g. a routine reminder. Browsers require every
    // push to result in a shown notification, so this briefly shows a silent one under the
    // same tag and closes it immediately, which closes the original alongside it.
    event.waitUntil(
      self.registration
        .showNotification(payload.title, { tag: payload.tag, silent: true, data: { url: payload.url } })
        .then(() => self.registration.getNotifications({ tag: payload.tag }))
        .then((notifications) => notifications.forEach((n) => n.close()))
    );
    return;
  }

  // Same tag replaces an earlier notification instead of stacking, so a routine cluster (or
  // a task/project without one) never piles up more than one visible reminder.
  event.waitUntil(
    self.registration.showNotification(payload.title, {
      body: payload.body,
      icon: "/icon.png",
      tag: payload.tag,
      data: { url: payload.url },
    })
  );
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const url = event.notification.data?.url || "/";
  event.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((clients) => {
      for (const client of clients) {
        if (client.url.includes(self.location.origin) && "focus" in client) return client.focus();
      }
      return self.clients.openWindow(url);
    })
  );
});
