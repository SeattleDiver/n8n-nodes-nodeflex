import {
	IExecuteFunctions,
	INodeExecutionData,
	INodeType,
	INodeTypeDescription,
	IDataObject
} from 'n8n-workflow';
import { PrivateWorkflowResponseRegistry } from '../../library/PrivateWorkflowResponseRegistry';

export class RespondToPrivateWorkflow implements INodeType {
	description: INodeTypeDescription = {
		displayName: 'Respond to Private Workflow',
		name: 'respondToPrivateWorkflow',
		group: ['output'],
		version: 1,
		description: 'Sends a response back to the Private Workflow Trigger via SignalR',
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
				type: 'json',
				typeOptions: {
					alwaysOpenEditWindow: true,
				},
				default: `={{ $json }}`,
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
				// The user explicitly provides JSON → send it exactly
				const jsonBody = this.getNodeParameter('responseData', 0) || {};
				payload = jsonBody;
				outputItems.push({ json: jsonBody as IDataObject });
				break;
			}

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

				if (binaryMode === 'manual') {
					const binaryPropertyName = this.getNodeParameter('binaryPropertyName', 0);
					binaryData = items[0].binary?.[binaryPropertyName];
				} else {
					const binaryObj = items[0].binary;
					if (binaryObj && Object.keys(binaryObj).length > 0) {
						const firstKey = Object.keys(binaryObj)[0];
						binaryData = binaryObj[firstKey];
					}
				}

				if (!binaryData) {
					this.logger?.warn?.(
						`[RespondToPrivateWorkflow] No binary data for correlation=${correlationId}`
					);
					payload = null;
					outputItems.push({ json: {} });
				} else {
					payload = binaryData;
					outputItems.push({ json: {}, binary: { data: binaryData } });
				}
				break;
			}

			case 'none':
			default:
				payload = null;
				outputItems.push({ json: {} });
				break;
		}



		// let payload: any;

		// const respondWith = this.getNodeParameter('respondWith', 0) as string;

		// switch (respondWith) {
		// 	case 'allItems':
		// 		payload = items.map(it => it.json);
		// 		outputItems.push(...items);
		// 		break;

		// 	case 'firstItem':
		// 		payload = items[0]?.json ?? null;
		// 		outputItems.push(items[0]);
		// 		break;

		// 	case 'json': {
		// 		const jsonBody = this.getNodeParameter('responseData', 0) || {};
		// 		payload = jsonBody;
		// 		outputItems.push({ json: jsonBody as IDataObject });
		// 		break;
		// 	}

		// 	case 'text': {
		// 		const text = String(this.getNodeParameter('responseText', 0));
		// 		payload = text;
		// 		outputItems.push({ json: { text } });
		// 		break;
		// 	}

		// 	case 'binary': {
		// 		const binaryMode = this.getNodeParameter('binaryMode', 0) as string;
		// 		let binaryData;

		// 		if (binaryMode === 'manual') {
		// 			const binaryPropertyName = this.getNodeParameter('binaryPropertyName', 0);
		// 			binaryData = items[0].binary?.[binaryPropertyName];
		// 		} else {
		// 			const binaryObj = items[0].binary;
		// 			if (binaryObj && Object.keys(binaryObj).length > 0) {
		// 				const firstKey = Object.keys(binaryObj)[0];
		// 				binaryData = binaryObj[firstKey];
		// 			}
		// 		}

		// 		if (!binaryData) {
		// 			this.logger?.warn?.(
		// 				`[RespondToPrivateWorkflow] No binary data for correlationId=${correlationId}`
		// 			);
		// 			payload = null;
		// 			outputItems.push({ json: {} });
		// 		} else {
		// 			payload = binaryData;
		// 			outputItems.push({ json: {}, binary: { data: binaryData } });
		// 		}
		// 		break;
		// 	}

		// 	case 'none':
		// 	default:
		// 		payload = null;
		// 		outputItems.push({ json: {} });
		// 		break;
		// }

		// ✅ Send a single response to the hub AFTER collecting payload
		this.logger?.info?.(
			`[RespondToPrivateWorkflow] Sending response → req=${entry.requestId}, corr=${correlationId}, mode=${respondWith}`
		);

		await entry.client.sendResponseToHub(entry.correlationId, 'Completed', entry.requestId, payload, entry.path);

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
