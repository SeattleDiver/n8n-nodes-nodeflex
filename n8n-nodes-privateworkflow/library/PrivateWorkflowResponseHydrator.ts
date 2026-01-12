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
    const correlationId: string | undefined = body?.correlationId;

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
            json: {
              status,
              correlationId,
            },
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
            json: {
              status,
              correlationId,
            },
          },
        ],
      };
    }

    // ------------------------------------------------------------
    // Inline payload handling
    // ------------------------------------------------------------
    if (payload.type === 'inline' && typeof payload.value === 'string') {

      let parsed: any;
      let isJson = false;

      try {
        parsed = JSON.parse(payload.value);
        isJson = true;
      } catch {
        parsed = payload.value; // plain text
      }

      // --------------------------------------------------------
      // Binary descriptor
      // --------------------------------------------------------
      if (
        isJson &&
        parsed &&
        typeof parsed === 'object' &&
        !Array.isArray(parsed) &&
        typeof parsed.data === 'string' &&
        typeof parsed.mimeType === 'string'
      ) {
        return {
          state: 'completed',
          items: [
            {
              json: {
                status,
                correlationId,
              },
              binary: {
                [binaryKey]: parsed,
              },
            },
          ],
        };
      }

      // --------------------------------------------------------
      // JSON payload
      // --------------------------------------------------------
      if (isJson) {

        if (Array.isArray(parsed)) {
          for (const element of parsed) {
            items.push({
              json: {
                status,
                correlationId,
                ...(element ?? {}),
              },
            });
          }
        } else {
          items.push({
            json: {
              status,
              correlationId,
              ...(parsed ?? {}),
            },
          });
        }

        return {
          state: 'completed',
          items,
        };
      }

      // --------------------------------------------------------
      // Text payload
      // --------------------------------------------------------
      return {
        state: 'completed',
        items: [
          {
            json: {
              status,
              correlationId,
              text: parsed,
            },
          },
        ],
      };
    }

    // ------------------------------------------------------------
    // Fallback: unknown payload shape
    // ------------------------------------------------------------
    return {
      state: 'completed',
      items: [
        {
          json: {
            status,
            correlationId,
          },
        },
      ],
    };
  }
}
