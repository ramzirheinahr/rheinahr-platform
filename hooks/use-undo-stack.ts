import { useState, useCallback } from "react";

export function useUndoStack<T>(initialState: T | (() => T)) {
  const [state, setState] = useState<T>(initialState);
  const [past, setPast] = useState<T[]>([]);
  const [future, setFuture] = useState<T[]>([]);

  const set = useCallback((newState: T | ((prevState: T) => T)) => {
    setState((currentState) => {
      const resolvedState = typeof newState === "function" ? (newState as (s: T) => T)(currentState) : newState;
      if (currentState === resolvedState) return currentState;
      
      setPast((prev) => [...prev, currentState].slice(-50)); // limit history to 50
      setFuture([]);
      return resolvedState;
    });
  }, []);

  const undo = useCallback(() => {
    if (past.length === 0) return;
    setPast((prev) => prev.slice(0, prev.length - 1));
    setFuture((prev) => [state, ...prev]);
    setState(past[past.length - 1]);
  }, [past, state]);

  const redo = useCallback(() => {
    if (future.length === 0) return;
    setFuture((prev) => prev.slice(1));
    setPast((prev) => [...prev, state]);
    setState(future[0]);
  }, [future, state]);

  const clearHistory = useCallback(() => {
    setPast([]);
    setFuture([]);
  }, []);

  // Update without adding to history (e.g. for syncing with server state without polluting undo)
  const replace = useCallback((newState: T | ((prevState: T) => T)) => {
    setState((currentState) => {
      const resolvedState = typeof newState === "function" ? (newState as (s: T) => T)(currentState) : newState;
      return resolvedState;
    });
  }, []);

  return {
    state,
    set,
    undo,
    redo,
    canUndo: past.length > 0,
    canRedo: future.length > 0,
    clearHistory,
    replace,
  };
}
