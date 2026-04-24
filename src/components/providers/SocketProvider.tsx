'use client';

import { createContext, useContext, useEffect, useState, useCallback, ReactNode, FC } from 'react';
import { io, Socket } from 'socket.io-client';

const WS_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:4000';

interface SocketContextType {
  socket: Socket | null;
  connected: boolean;
  subscribeToToken: (mint: string) => void;
  unsubscribeFromToken: (mint: string) => void;
  subscribeToFeed: () => void;
  unsubscribeFromFeed: () => void;
}

const SocketContext = createContext<SocketContextType>({
  socket: null,
  connected: false,
  subscribeToToken: () => {},
  unsubscribeFromToken: () => {},
  subscribeToFeed: () => {},
  unsubscribeFromFeed: () => {},
});

export const useSocket = () => useContext(SocketContext);

interface SocketProviderProps {
  children: ReactNode;
}

export const SocketProvider: FC<SocketProviderProps> = ({ children }) => {
  const [socket, setSocket] = useState<Socket | null>(null);
  const [connected, setConnected] = useState(false);

  useEffect(() => {
    // console.log('🔌 Connecting to WebSocket server:', WS_URL);
    
    const newSocket = io(WS_URL, {
      transports: ['websocket', 'polling'],
      reconnection: true,
      reconnectionAttempts: 10,
      reconnectionDelay: 1000,
    });

    newSocket.on('connect', () => {
      // console.log('🔌 Socket connected:', newSocket.id);
      setConnected(true);
    });

    newSocket.on('disconnect', () => {
      // console.log('🔌 Socket disconnected');
      setConnected(false);
    });

    newSocket.on('connect_error', (error) => {
      console.error('🔌 Socket connection error:', error.message);
    });

    // Debug: Log all incoming events
    newSocket.onAny((eventName, ...args) => {
      // console.log('📥 Socket event received:', eventName, args.length > 0 ? args[0] : '');
    });

    setSocket(newSocket);

    return () => {
      newSocket.disconnect();
    };
  }, []);

  const subscribeToToken = useCallback((mint: string) => {
    if (socket?.connected) {
      // console.log('🔔 Subscribing to token:', mint);
      socket.emit('subscribe:token', mint);
    } else {
      // console.warn('⚠️ Socket not connected, cannot subscribe to token:', mint);
    }
  }, [socket]);

  const unsubscribeFromToken = useCallback((mint: string) => {
    if (socket?.connected) {
      // console.log('🔕 Unsubscribing from token:', mint);
      socket.emit('unsubscribe:token', mint);
    }
  }, [socket]);

  const subscribeToFeed = useCallback(() => {
    if (socket?.connected) {
      socket.emit('subscribe:feed');
    }
  }, [socket]);

  const unsubscribeFromFeed = useCallback(() => {
    if (socket?.connected) {
      socket.emit('unsubscribe:feed');
    }
  }, [socket]);

  return (
    <SocketContext.Provider
      value={{
        socket,
        connected,
        subscribeToToken,
        unsubscribeFromToken,
        subscribeToFeed,
        unsubscribeFromFeed,
      }}
    >
      {children}
    </SocketContext.Provider>
  );
};
