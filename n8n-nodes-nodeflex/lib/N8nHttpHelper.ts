/* eslint-disable @typescript-eslint/no-explicit-any */
import { IHttpRequestOptions } from 'n8n-workflow';

/**
 * Lightweight interface for HTTP requests via n8n helpers.
 *
 * Lib classes accept this instead of the full IExecuteFunctions/ITriggerFunctions,
 * keeping them loosely coupled to the n8n runtime.
 *
 * Node files pass it as: `{ httpRequest: this.helpers.httpRequest.bind(this.helpers) }`
 */
export interface IN8nHttpHelper {
	httpRequest(options: IHttpRequestOptions): Promise<any>;
}
