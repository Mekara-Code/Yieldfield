import type { WebSocket } from 'ws';
import type { Client } from './auth';

export interface Connection {
  socket: WebSocket;
  userId: string;
  username: string;
  client: Client;
}

/**
 * Everyone connected by WebSocket: the game (one per player: a second sign-in replaces the
 * first) and the site's dashboards, which hear their farm change as the game saves.
 */
class Hub {
  private connections = new Set<Connection>();

  add(connection: Connection) {
    if (connection.client === 'game') {
      for (const other of this.connections) {
        if (other.userId === connection.userId && other.client === 'game') {
          send(other.socket, { type: 'session:replaced', message: 'Signed in on another computer' });
          other.socket.close(4001, 'replaced');
          this.connections.delete(other);
        }
      }
    }
    this.connections.add(connection);
    this.broadcastPresence();
    if (connection.client === 'game') {
      this.toUser(connection.userId, { type: 'status', playing: true }, 'web');
    }
  }

  remove(connection: Connection) {
    if (this.connections.delete(connection)) {
      this.broadcastPresence();
      if (connection.client === 'game') {
        this.toUser(connection.userId, { type: 'status', playing: this.isPlaying(connection.userId) }, 'web');
      }
    }
  }

  /** Players with the game open. */
  playersOnline() {
    return new Set([...this.connections].filter((c) => c.client === 'game').map((c) => c.userId)).size;
  }

  isPlaying(userId: string) {
    return [...this.connections].some((c) => c.userId === userId && c.client === 'game');
  }

  toUser(userId: string, message: object, client?: Client) {
    for (const c of this.connections) {
      if (c.userId === userId && (!client || c.client === client)) {
        send(c.socket, message);
      }
    }
  }

  private broadcastPresence() {
    const message = { type: 'presence', online: this.playersOnline() };
    for (const c of this.connections) {
      send(c.socket, message);
    }
  }
}

export function send(socket: WebSocket, message: object) {
  if (socket.readyState === socket.OPEN) {
    socket.send(JSON.stringify(message));
  }
}

const holder = globalThis as unknown as { __farmHub?: Hub };
export const hub: Hub = holder.__farmHub ?? (holder.__farmHub = new Hub());
