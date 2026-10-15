import {useEffect, useState} from 'react';

/**
 * The time now, in epoch millis, updated each second while `isRunning` - for elapsed times and
 * clock-based states such as stalled. Stops ticking, and keeps its last value, while not running.
 * @internal
 */
export function useChatClock(isRunning: boolean): number {
    const [now, setNow] = useState(Date.now);

    useEffect(() => {
        if (!isRunning) return undefined;
        setNow(Date.now());
        const timer = setInterval(() => setNow(Date.now()), TICK_MS);
        return () => clearInterval(timer);
    }, [isRunning]);

    return now;
}

const TICK_MS = 1000;
