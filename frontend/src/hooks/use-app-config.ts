import { useEffect, useState } from 'react';
import { getAppConfig } from '../api';
import { FALLBACK_MAX_CONTEXT_TOKENS } from '../app/constants';

export function useMaxContextTokens() {
  const [maxContextTokens, setMaxContextTokens] = useState(FALLBACK_MAX_CONTEXT_TOKENS);

  useEffect(() => {
    getAppConfig()
      .then(config => {
        if (typeof config.max_context_tokens === 'number') {
          setMaxContextTokens(config.max_context_tokens);
        }
      })
      .catch(() => {
        // keep fallback
      });
  }, []);

  return maxContextTokens;
}

