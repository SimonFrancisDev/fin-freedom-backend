const clients = new Set();

export function addTaskLiveClient(res) {
  clients.add(res);
  return () => clients.delete(res);
}

export function publishTaskEvent(type, payload = {}) {
  const message = `event: ${type}\ndata: ${JSON.stringify({ type, ...payload, at: Date.now() })}\n\n`;
  for (const client of clients) {
    try { client.write(message); } catch { clients.delete(client); }
  }
}

export function taskLiveClientCount() { return clients.size; }
