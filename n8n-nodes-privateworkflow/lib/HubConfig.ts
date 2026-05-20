/**
 * Central configuration for the NodeFlex hub.
 * Every module that needs the hub URL should import from here.
 */
// export const HUB_BASE_URL = 'https://hub.nodeflex.io';
export const HUB_BASE_URL = 'https://localhost:7093';

/** Full URL used by credential test requests to verify an API key. */
export const HUB_VERIFY_URL = `${HUB_BASE_URL}/api/apikeys/verify`;
