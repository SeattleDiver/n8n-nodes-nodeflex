import { INodeExecutionData } from 'n8n-workflow';

export interface HydrationOptions {
  binaryPropertyName?: string; // default: 'file'
}

export interface HydrationResult {
  state: 'completed' | 'pending';
  items: INodeExecutionData[];
}

export class PrivateWorkflowResponseHydrator {

  static hydrate(
    body: any,
    options: HydrationOptions = {}
  ): HydrationResult {

    const binaryKey = options.binaryPropertyName ?? 'file';
    const status: string | undefined = body?.status;

    if (!status) {
      throw new Error('Response missing status');
    }

    // ------------------------------------------------------------
    // Pending states
    // ------------------------------------------------------------
    if (status === 'Queued' || status === 'Running' || status === 'Pending') {
      return {
        state: 'pending',
        items: [
          {
            json: { status },
          },
        ],
      };
    }

    // ------------------------------------------------------------
    // Completed state
    // ------------------------------------------------------------
    if (status !== 'Completed') {
      throw new Error(`Unknown workflow status: ${status}`);
    }

    const payload = body?.payload;
    const items: INodeExecutionData[] = [];

    // ------------------------------------------------------------
    // No payload
    // ------------------------------------------------------------
    if (!payload || payload.value == null) {
      return {
        state: 'completed',
        items: [
          {
            json: { status },
          },
        ],
      };
    }

    // ------------------------------------------------------------
    // Inline payload
    // ------------------------------------------------------------
    if (payload.type === 'inline' && typeof payload.value === 'string') {

      const encoding = payload.encoding as
        | 'json'
        | 'text'
        | 'base64'
				| 'none'
        | undefined;

      // --------------------------------------------------------
      // JSON encoding
      // --------------------------------------------------------
      if (encoding === 'json') {
        let parsed: any;

        try {
          parsed = JSON.parse(payload.value);
        } catch {
          throw new Error('Invalid JSON payload');
        }

        if (Array.isArray(parsed)) {
          for (const element of parsed) {
            items.push({
              json: {
                status,
                ...(element ?? {}),
              },
            });
          }
        } else {
          items.push({
            json: {
              status,
              ...(parsed ?? {}),
            },
          });
        }

        return { state: 'completed', items };
      }

      // --------------------------------------------------------
      // TEXT encoding
      // --------------------------------------------------------
      if (encoding === 'text') {
        return {
          state: 'completed',
          items: [
            {
              json: {
                status,
                text: payload.value,
              },
            },
          ],
        };
      }

      // --------------------------------------------------------
      // BASE64 (binary) encoding
      // --------------------------------------------------------
      if (encoding === 'base64') {
        return {
          state: 'completed',
          items: [
            {
              json: { status },
              binary: {
                [binaryKey]: {
                  data: payload.value,
                  mimeType: 'application/octet-stream',
                  fileName: 'workflow-response.bin',
                },
              },
            },
          ],
        };
      }

			// --------------------------------------------------------
      // none encoding
      // --------------------------------------------------------
      if (encoding === 'none') {
        return {
          state: 'completed',
          items: [
            {
              json: {
                status
              },
            },
          ],
        };
      }

      // --------------------------------------------------------
      // Legacy fallback (no encoding specified)
      // --------------------------------------------------------
      let parsed: any;
      let isJson = false;

      try {
        parsed = JSON.parse(payload.value);
        isJson = true;
      } catch {
        parsed = payload.value;
      }

      if (isJson && typeof parsed === 'object' && !Array.isArray(parsed)) {
        return {
          state: 'completed',
          items: [
            {
              json: {
                status,
                ...(parsed ?? {}),
              },
            },
          ],
        };
      }

      return {
        state: 'completed',
        items: [
          {
            json: {
              status,
              text: parsed,
            },
          },
        ],
      };
    }

    // ------------------------------------------------------------
    // Reference payload (future-safe)
    // ------------------------------------------------------------
    if (payload.type === 'reference') {
      return {
        state: 'completed',
        items: [
          {
            json: {
              status,
              url: payload.url,
              length: payload.length,
              encoding: payload.encoding,
            },
          },
        ],
      };
    }

    // ------------------------------------------------------------
    // Fallback
    // ------------------------------------------------------------
    return {
      state: 'completed',
      items: [
        {
          json: { status },
        },
      ],
    };
  }
}
