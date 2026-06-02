import { useStdout } from 'ink';
import { useEffect, useState } from 'react';

export function useTerminalSize(): { rows: number; columns: number } {
  const { stdout } = useStdout();

  const [size, setSize] = useState(() => ({
    rows: stdout.rows ?? 24,
    columns: stdout.columns ?? 80,
  }));

  useEffect(() => {
    const onResize = () => {
      setSize({
        rows: stdout.rows ?? 24,
        columns: stdout.columns ?? 80,
      });
    };

    stdout.on('resize', onResize);
    onResize();
    return () => {
      stdout.off('resize', onResize);
    };
  }, [stdout]);

  return size;
}
