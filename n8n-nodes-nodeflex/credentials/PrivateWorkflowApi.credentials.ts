import type {
	IAuthenticateGeneric,
	ICredentialType,
	INodeProperties,
	ICredentialTestRequest,
	IHttpRequestMethods,
} from 'n8n-workflow';

import { HUB_VERIFY_URL, PORTAL_URL } from '../lib/HubConfig';

export class PrivateWorkflowApi implements ICredentialType {
	name = 'privateWorkflowApi';
	displayName = 'Private Workflow Credentials API';
	icon = 'fa:key' as const;
	documentationUrl = 'https://github.com/NodeFlexIO/PrivateWorkflow';
	description = 'Authentication credentials for executing a NodeFlex Private Workflow';

	// The standard n8n properties definition
	properties: INodeProperties[] = [
		{
			displayName: `Get your API key from <a href="${PORTAL_URL}" target="_blank">portal.nodeflex.io</a>`,
			name: 'portalNotice',
			type: 'notice',
			default: '',
		},
		{
			displayName: 'API Key',
			name: 'apiKey',
			type: 'string',
			typeOptions: { password: true },
			default: '',
			required: true,
			description: 'API key for authenticating with the NodeFlex Private Workflow API',
		},
	];

	// Attaches the API key to every request made via httpRequestWithAuthentication
	authenticate: IAuthenticateGeneric = {
		type: 'generic',
		properties: {
			headers: {
				'x-api-key': '={{$credentials.apiKey}}',
			},
		},
	};

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
