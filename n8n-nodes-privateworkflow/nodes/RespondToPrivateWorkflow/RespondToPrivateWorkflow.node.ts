import {
	IExecuteFunctions,
	INodeExecutionData,
	INodeType,
	INodeTypeDescription,
	IDataObject,
	NodeOperationError
} from 'n8n-workflow';
import { PrivateWorkflowResponseRegistry } from '../../library/PrivateWorkflowResponseRegistry';

export class RespondToPrivateWorkflow implements INodeType {
	description: INodeTypeDescription = {
		displayName: 'Respond to Private Workflow 0004',
		name: 'respondToPrivateWorkflow',
		group: ['output'],
		version: 1,
		description: 'Sends a response back to the Private Workflow Trigger via SignalR RESPOND NODE - NEW DEFAULT LOADED',
		icon: 'file:cloud-network-chevron-response.svg',
		defaults: {
			name: 'Respond to Private Workflow',
			color: '#00c896',
		},
		inputs: ['main'],
		outputs: ['main'],
		properties: [
			{
				displayName: 'Respond With',
				name: 'respondWith',
				type: 'options',
				default: 'allItems',
				description: 'What data should be returned to the Private Workflow Trigger',
				options: [
					{
						name: 'All Incoming Items',
						value: 'allItems',
						description: 'Respond with all input JSON items',
					},
					{
						name: 'Binary File',
						value: 'binary',
						description: 'Respond with incoming file binary data',
					},
					{
						name: 'First Incoming Item',
						value: 'firstItem',
						description: 'Respond with the first input JSON item',
					},
					{
						name: 'JSON',
						value: 'json',
						description: 'Respond with a custom JSON body',
					},
					{
						name: 'No Data',
						value: 'none',
						description: 'Respond with an empty body',
					},
					{
						name: 'Text',
						value: 'text',
						description: 'Respond with a simple text message body',
					},
				],
			},

			// ---------- JSON Response ----------
			{
				displayName: 'Response Body',
				name: 'responseData',
				type: 'string',
				typeOptions: {
					rows: 4
				},
				default: `{{ $json }}`,
				description: 'The JSON to send in the response',
				displayOptions: {
					show: {
						respondWith: ['json'],
					},
				},
			},

			// ---------- Text Response ----------
			{
				displayName: 'Response Text',
				name: 'responseText',
				type: 'string',
				typeOptions: {
					rows: 4,
				},
				default: '',
				placeholder: 'Enter plain text response here...',
				description: 'Text to return to the Private Workflow Trigger',
				displayOptions: {
					show: {
						respondWith: ['text'],
					},
				},
			},

			// ---------- Binary Source Mode ----------
			{
				displayName: 'Response Data Source',
				name: 'binaryMode',
				type: 'options',
				default: 'auto',
				description: 'How to select the binary data to return',
				displayOptions: {
					show: {
						respondWith: ['binary'],
					},
				},
				options: [
					{
						name: 'Choose Automatically from Input',
						value: 'auto',
						description: 'Use the first binary property found on the incoming item',
					},
					{
						name: 'Specify Myself',
						value: 'manual',
						description: 'Select a specific binary property from input',
					},
				],
			},
			{
				displayName: 'Correlation ID',
				name: 'correlationId',
				type: 'string',
				default: '',
				required: true,
				description:
					'Select the correlation ID from your Private Workflow Trigger output, e.g. {{ $("Private Workflow Trigger").item.json.__correlationId }}',
				hint: 'Use expression editor to choose it from your trigger node',
			},
			{
				displayName: 'Binary Property',
				name: 'binaryPropertyName',
				type: 'string',
				default: 'data',
				description: 'Name of the binary property to return',
				displayOptions: {
					show: {
						respondWith: ['binary'],
						binaryMode: ['manual'],
					},
				},
			},
		]
	};

	async execute(this: IExecuteFunctions): Promise<INodeExecutionData[][]> {
		const items = this.getInputData();
		this.logger.info(`getInputData() returns: ${JSON.stringify(items)}`)
		const outputItems: INodeExecutionData[] = [];

	  const correlationId = this.getNodeParameter('correlationId', 0) as string;
		const entry = PrivateWorkflowResponseRegistry.get(correlationId);

		if (!entry) {
			this.logger?.warn?.(
				`[RespondToPrivateWorkflow] No pending SignalR entry for correlation=${correlationId}`
			);
			// still return items so workflow debugging isn't broken
			return [items];
		}

		let payload: any;

		const respondWith = this.getNodeParameter('respondWith', 0) as string;

		// Helper: extract the payload interior only
		const extractPayload = (item: INodeExecutionData) => {
			const { payload } = item.json as any;
			return payload ?? null;
		};

		switch (respondWith) {

			case 'allItems': {
				// Return ONLY the payload interior for every input
				payload = items.map(extractPayload);
				outputItems.push(
					...items.map(it => ({ json: extractPayload(it) as IDataObject }))
				);
				break;
			}

			case 'firstItem': {
				const firstPayload = extractPayload(items[0]);
				payload = firstPayload;
				outputItems.push({ json: firstPayload as IDataObject });
				break;
			}

			case 'json': {
				const raw = this.getNodeParameter('responseData', 0);

				let parsed: IDataObject;

				// 1️⃣ If n8n already gave us an object, use it
				if (raw !== null && typeof raw === 'object' && !Array.isArray(raw)) {
					// Deep clone to break n8n references
					parsed = JSON.parse(JSON.stringify(raw));
				}

				// 2️⃣ If it's a string, try to parse it as JSON
				else if (typeof raw === 'string') {
					const trimmed = raw.trim();

					if (!trimmed) {
						throw new NodeOperationError(
							this.getNode(),
							'Response Body is empty; expected valid JSON'
						);
					}

					try {
						const value = JSON.parse(trimmed);

						if (value === null || typeof value !== 'object' || Array.isArray(value)) {
							throw new NodeOperationError(this.getNode(), 'Parsed JSON is not an object');
						}

						parsed = value as IDataObject;
					} catch {
						throw new NodeOperationError(
							this.getNode(),
							'Response Body must contain valid JSON (object)'
						);
					}
				}

				// 3️⃣ Anything else is unsupported
				else {
					throw new NodeOperationError(
						this.getNode(),
						`Response Body resolved to unsupported type (${typeof raw}); expected JSON object`
					);
				}

				// 🔑 Canonical payload (SignalR)
				payload = parsed;

				// 🔑 Canonical output (n8n)
				outputItems.push({ json: parsed });

				break;
			}


			// case 'json': {
			// 	const raw = this.getNodeParameter('responseData', 0);

			// 	if (typeof raw !== 'string') {
			// 		throw new NodeOperationError(
			// 			this.getNode(),
			// 			'Response Body must be a JSON string'
			// 		);
			// 	}

			// 	let parsed: IDataObject;

			// 	try {
			// 		parsed = JSON.parse(raw);
			// 	} catch {
			// 		throw new NodeOperationError(
			// 			this.getNode(),
			// 			'Response Body must contain valid JSON'
			// 		);
			// 	}

			// 	// 🔑 parsed object becomes the payload
			// 	payload = parsed;

			// 	// 🔑 n8n output uses the SAME parsed object
			// 	outputItems.push({ json: parsed });

			// 	break;
			// }

			// case 'json': {
			// 	// The user explicitly provides JSON → send it exactly
			// 	const jsonBody = this.getNodeParameter('responseData', 0) || {};
			// 	payload = jsonBody;
			// 	outputItems.push({ json: jsonBody as IDataObject });
			// 	break;
			// }

			case 'text': {
				// Simple text body
				const text = String(this.getNodeParameter('responseText', 0));
				payload = text;
				outputItems.push({ json: { text } });
				break;
			}

			case 'binary': {
				const binaryMode = this.getNodeParameter('binaryMode', 0) as string;

				let binaryData;
				let binaryPropertyName: string | undefined;

				if (binaryMode === 'manual') {
					binaryPropertyName = this.getNodeParameter('binaryPropertyName', 0) as string;
					binaryData = items[0].binary?.[binaryPropertyName];
				} else {
					const binaryObj = items[0].binary;
					if (binaryObj && Object.keys(binaryObj).length > 0) {
						binaryPropertyName = Object.keys(binaryObj)[0];
						binaryData = binaryObj[binaryPropertyName];
					}
				}

				if (!binaryData || !binaryPropertyName) {
					this.logger?.warn?.(
						`[RespondToPrivateWorkflow] No binary data for correlation=${correlationId}`
					);

					payload = null;

					outputItems.push({
						json: { correlationId, status: 'Success' },
					});

				} else {
					// 🔑 Preserve the binary exactly as n8n expects
					payload = binaryData;

					outputItems.push({
						json: { correlationId, status: 'Success' },
						binary: {
							[binaryPropertyName]: binaryData,
						},
					});
				}

				break;
			}

			case 'none':
			default:
				payload = null;
				outputItems.push({ json: {} });
				break;
		}

		// Canonical payload (this is the truth)
		let basePayload: IDataObject | null = null;

		if (payload === null) {
			basePayload = null;
		} else if (typeof payload === 'string') {
			// Last-chance parse (defensive)
			try {
				basePayload = JSON.parse(payload);
			} catch {
				throw new NodeOperationError(this.getNode(), '[RespondToPrivateWorkflow] Payload resolved to string; expected object');
			}
		} else if (typeof payload === 'object') {
			// Deep clone to break n8n refs
			basePayload = JSON.parse(JSON.stringify(payload));
		} else {
			throw new NodeOperationError(this.getNode(), `[RespondToPrivateWorkflow] Invalid payload type: ${typeof payload}`);
		}

		// ------------------------------------------------------------------------------------
		// Send a single response to the hub AFTER collecting payload
		// ------------------------------------------------------------------------------------
		this.logger?.info?.(
			`[RespondToPrivateWorkflow] Sending response → req=${entry.requestId}, corr=${correlationId}, mode=${respondWith}`
		);

		await entry.client.sendResponseToHub(
			entry.correlationId,
			'Completed',
			entry.requestId,
			basePayload,
			entry.path
		);

		// ✅ Cleanup once
		clearTimeout(entry.timeout);
		PrivateWorkflowResponseRegistry.delete(correlationId);

		this.logger?.info?.(
			`[RespondToPrivateWorkflow] ✅ Response sent & cleared (corr=${correlationId})`
		);

		// ✅ Return items to workflow
		return [outputItems];
	}
}
