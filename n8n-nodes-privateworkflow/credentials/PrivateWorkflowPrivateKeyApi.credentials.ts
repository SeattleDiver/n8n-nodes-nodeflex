import type {
	ICredentialType,
	INodeProperties,
	ICredentialTestRequest,
	IHttpRequestMethods,
} from 'n8n-workflow';

import { HUB_VERIFY_URL } from '../lib/HubConfig';

export class PrivateWorkflowPrivateKeyApi implements ICredentialType {
	name = 'privateWorkflowPrivateKeyApi';
	displayName = 'Private Workflow Credentials with Private Key API';
	icon = 'fa:key' as const;
	documentationUrl = 'https://github.com/SeattleDiver/nodeflex-workflow';
	description = `Authentication credentials for the Private Workflow with Private Key.

	**Documentation:** [View Setup Guide](https://github.com/SeattleDiver/nodeflex-workflow)`;

	// 👇 The standard n8n properties definition
	properties: INodeProperties[] = [
		{
			displayName: 'API Key',
			name: 'apiKey',
			type: 'string',
			typeOptions: { password: true },
			default: '',
			required: true,
			description: 'API key for authenticating with the NodeFlex Private Workflow API.',
		},
		{
			displayName: 'Private Key for Payload encryption/decription',
			name: 'privateKey',
			type: 'string',
			typeOptions: { rows: 5, password: true },
			default: '',
			required: false,
			description: 'Private key used to decrypt/encrypt requests and responses.',
		},
	];

	// Define the built-in test connection configuration
	test: ICredentialTestRequest = {
		request: {
			method: 'GET' as IHttpRequestMethods,
			url: `=${HUB_VERIFY_URL}`,
			qs: {
				apiKey: '={{$credentials.apiKey}}',
			},
		},
	};
}
