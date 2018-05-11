/*
  * Copyright 2017 Amazon.com, Inc. and its affiliates. All Rights Reserved.
  *
  * Licensed under the MIT License. See the LICENSE accompanying this file
  * for the specific language governing permissions and limitations under
  * the License.
  */

import tl = require('vsts-task-lib/task');
import path = require('path');
import fs = require('fs');
import STS = require('aws-sdk/clients/sts');
import IAM = require('aws-sdk/clients/iam');
import AWS = require('aws-sdk/global');
import { AWSTaskParametersBase } from './awsTaskParametersBase';

export abstract class SdkUtils {

    // Injects a custom user agent conveying extension version and task being run into the
    // sdk so usage metrics can be tied to the tools.
    public static setSdkUserAgentFromManifest(taskManifestFilePath: string): void {

        if (fs.existsSync(taskManifestFilePath)) {
            const taskManifest = JSON.parse(fs.readFileSync(taskManifestFilePath, 'utf8'));
            const version = taskManifest.version;
            const userAgentString = 'AWS-VSTS/' +
                version.Major + '.' + version.Minor + '.' + version.Patch +
                ' exec-env/VSTS-' + taskManifest.name;

            (AWS as any).util.userAgent = () => {
                return userAgentString;
            };
        } else {
            console.warn(`Task manifest ${taskManifestFilePath} not found, cannot set custom user agent!`);
        }
    }

    // prefer Agent.TempDirectory but if not available due to use of a lower agent version
    // (it was added in agent v2.115.0), fallback to using TEMP
    public static getTempLocation(): string {
        let tempDirectory = tl.getVariable('Agent.TempDirectory');
        if (!tempDirectory) {
            tempDirectory = process.env.TEMP;
            console.log(`Agent.TempDirectory not available, falling back to TEMP location at ${tempDirectory}`);
        }

        return tempDirectory;
    }

    // Returns a new instance of a service client, having attached request handlers
    // to enable tracing of request/response data if the task is so configured. The
    // default behavior for all clients is to simply emit the service request ID
    // to the task log.
    public static createAndConfigureSdkClient(awsService: any,
                                              awsServiceOpts: any,
                                              taskParams: AWSTaskParametersBase,
                                              logger: (msg: string) => void): any {

        awsService.prototype.customizeRequests((request) => {

            const logRequestData = taskParams.logRequestData;
            const logResponseData = taskParams.logResponseData;
            const operation = request.operation;

            request.on('complete', (response) => {

                try {
                    logger(`AWS ${operation} request ID: ${response.requestId}`);

                    const httpRequest = response.request.httpRequest;
                    const httpResponse = response.httpResponse;

                    // Choosing to not log request or response body content at this stage, partly to avoid
                    // having to detect and avoid streaming content or object uploads, and partly to avoid
                    // the possibility of logging sensitive data
                    if (logRequestData) {
                        logger(`---Request data for ${response.requestId}---`);
                        logger(`  Path: ${httpRequest.path}`);
                        logger('  Headers:');
                        Object.keys(httpRequest.headers).forEach((element) => {
                            logger(`    ${element}=${httpRequest.headers[element]}`);
                        });
                    }

                    if (logResponseData) {
                        logger(`---Response data for request ${response.requestId}---`);
                        logger(`  Status code: ${httpResponse.statusCode}`);
                        if (response.httpResponse.headers) {
                            logger(`  Headers:`);
                            for (const k of Object.keys(httpResponse.headers)) {
                                logger(`    ${k}=${httpResponse.headers[k]}`);
                            }
                        }
                    }
                } catch (err) {
                    logger(`  Error inspecting request/response data, ${err}`);
                }
            });
        });

        return new awsService(awsServiceOpts);
    }

    public static async  roleArnFromName(iamClient: IAM, roleName: string): Promise<string> {
        if (roleName.startsWith('arn:')) {
            return roleName;
        }

        try {
            console.log(`Attempting to retrieve Amazon Resource Name (ARN) for role ${roleName}`);

            const response = await iamClient.getRole({
                RoleName: roleName
            }).promise();
            return response.Role.Arn;
        } catch (err) {
            throw new Error(`Error while obtaining ARN: ${err}`);
        }
    }
}
