export type WorkflowPayloadEncoding =
	| 'json'        // value is a JSON string that should be JSON.parse'd
	| 'text'        // value is a plain string (use as-is)
	| 'base64'      // value is base64-encoded binary
	| 'none'        // value is none - no encoding
	;
