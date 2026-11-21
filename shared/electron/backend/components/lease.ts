import { holdOperationLease, operationLeaseAbsent } from '../operationLease';

export { validLeaseToken as validComponentLease } from '../operationLease';
export const holdComponentLease = (token: string) => holdOperationLease('component', token);
export const componentLeaseAbsent = (token: string) => operationLeaseAbsent('component', token);
