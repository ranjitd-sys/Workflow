import { assign, setup } from 'xstate';
import type {
  SendEmailContext,
  SendEmailEvent,
  SendEmailParameterName,
  SendEmailActionIdentificationResult,
} from './types';

const REQUIRED_PARAMETERS: readonly SendEmailParameterName[] = ['to', 'subject', 'body'];

function isSendEmailResult(result: SendEmailActionIdentificationResult): boolean {
  return (
    result.action.identifier === 'send_email' &&
    result.action.status === 'clear'
  );
}

function toParameters(result: SendEmailActionIdentificationResult): SendEmailContext['parameters'] {
  const parameters: SendEmailContext['parameters'] = {};
  for (const parameter of result.parameters) {
    if (REQUIRED_PARAMETERS.includes(parameter.name as SendEmailParameterName)) {
      parameters[parameter.name as SendEmailParameterName] = parameter.value;
    }
  }
  return parameters;
}

function missingParameters(result: SendEmailActionIdentificationResult): SendEmailParameterName[] {
  return result.missing.filter((name): name is SendEmailParameterName =>
    REQUIRED_PARAMETERS.includes(name as SendEmailParameterName),
  );
}

export function createSendEmailWorkflow() {
  return setup({
    types: {
      context: {} as SendEmailContext,
      events: {} as SendEmailEvent,
    },
    guards: {
      isSendEmailResult: ({ event }) =>
        event.type === 'IDENTIFIED' && isSendEmailResult(event.result),
      resultHasMissingParameters: ({ event }) =>
        event.type === 'IDENTIFIED' &&
        isSendEmailResult(event.result) &&
        missingParameters(event.result).length > 0,
      resultIsComplete: ({ event }) =>
        event.type === 'IDENTIFIED' &&
        isSendEmailResult(event.result) &&
        missingParameters(event.result).length === 0,
      clarificationResultHasMissingParameters: ({ event }) =>
        event.type === 'CLARIFICATION_CHOSEN' &&
        missingParameters(event.result).length > 0,
      clarificationResultIsComplete: ({ event }) =>
        event.type === 'CLARIFICATION_CHOSEN' &&
        missingParameters(event.result).length === 0,
      retryCanConfirm: ({ context }) =>
        REQUIRED_PARAMETERS.every((name) => Boolean(context.parameters[name])),
      stillMissingParameters: ({ context, event }) => {
        if (event.type !== 'PARAMETER_PROVIDED') return false;
        return context.missing.filter((name) => name !== event.name).length > 0;
      },
      allParametersPresent: ({ context, event }) => {
        if (event.type !== 'PARAMETER_PROVIDED') return false;
        return context.missing.filter((name) => name !== event.name).length === 0;
      },
    },
    actions: {
      storeIdentificationResult: assign(({ event }) => {
        if (event.type !== 'IDENTIFIED') return {};
        return {
          result: event.result,
          parameters: toParameters(event.result),
          missing: missingParameters(event.result),
          error: undefined,
          execution: null,
        };
      }),
      storeClarificationResult: assign(({ event }) => {
        if (event.type !== 'NEEDS_CLARIFICATION') return {};
        return {
          result: event.result,
          error: undefined,
        };
      }),
      storeIdentificationError: assign(({ event }) => {
        if (event.type !== 'IDENTIFICATION_FAILED') return {};
        return {
          error: event.error,
        };
      }),
      storeClarificationChoice: assign(({ event }) => {
        if (event.type !== 'CLARIFICATION_CHOSEN') return {};
        return {
          result: event.result,
          parameters: toParameters(event.result),
          missing: missingParameters(event.result),
          error: undefined,
          execution: null,
        };
      }),
      startEditing: assign(() => ({
        missing: [...REQUIRED_PARAMETERS],
        error: undefined,
      })),
      mergeParameter: assign(({ context, event }) => {
        if (event.type !== 'PARAMETER_PROVIDED') return {};
        const parameters = {
          ...context.parameters,
          [event.name]: event.value,
        };
        const missing = context.missing.filter((name) => name !== event.name);
        return {
          parameters,
          missing,
          error: undefined,
        };
      }),
      storeExecutionSuccess: assign(({ event }) => {
        if (event.type !== 'EXECUTION_SUCCEEDED') return {};
        return {
          execution: { messageId: event.messageId },
          error: undefined,
        };
      }),
      storeExecutionError: assign(({ event }) => {
        if (event.type !== 'EXECUTION_FAILED') return {};
        return {
          error: event.error,
        };
      }),
      resetWorkflow: assign(() => ({
        actionId: 'send_email' as const,
        parameters: {},
        missing: [],
        result: null,
        execution: null,
        error: undefined,
      })),
    },
  }).createMachine({
    /** @xstate-layout N4IgpgJg5mDOIC5SzAOwgUQLYEMCWANgHR4QFgDEAygKoBCAsgJIAqA+gxlVQIIDiGANoAGALqJQABwD2sPABc801BJAAPRACZNANgCcRAOwBGTQFY9wncN2HhAFgA0IAJ6IAHMaKa9vvQGZ7Yx1jQz0AX3DnFHRsfGJScgoAJS4MFhFxJBAZOUVlVQ0ETXtDQyNDM2E-Q38zUx1nN2Kyoj13f0Dff0N3ezN+yOi0TFxCEgg0RQAzFzxUKAomABEMADkWJgAxJgxlzNVchSUVbKLNfx0iDsrhf2N7e3cOsybEPVCKvU1jPuMrBxDEAxUbxCZTPCzeaLFbrTY7PaCYxZKSyY4FM5aS7XHpVe6PZ51N4IOzuIxBEw6PodS5AkFxcakCFQhZLVYbba7faaFE5NH5U6gc7Ym54h5PF7EiwGfwfOzfapWHR0kYMhKTVAzOastYYPZUNgAYQAMjxkpzDTxNgB5NYHbJHAWFLFXUV3cWE16uRDGf5knT2fzuC46QJVdoq2JjdXM7Uw9nwpiWm1rNhbHhMY2IsSHfknZ3FEW490EyXe4rCLw6KrCSvCMwDCWR0GMjVa6EUS1rQ0YY321F5fOYwuu4v4iVE8vGfyacrB-yV30B+rBZtqogAYwIOAATpC49R6Mx2JxuPwhDmHXmMULELKybVKv8fjpQ2F-MT-mYyXpA+5hC8FiGGu0abtue4sosJpmhaVpMLaRoABLWlQ6z9nyg43uoiC1GY1zmDYjz2DoJSXJ+AJECEDi3NooZUiBYJbru+4dl2PZ9peA7ooK2EknU+FVCUjwkYGjRTpowjlKUC53GY5glJoDHjBu0gEOQG6KKyAAKZo8JwLAYMkbBack1oAGqwvsnEYdxBbtP4RBWOYnSmJctjEu49REGYhg+LUxF3FS7hKcQKlqWAGkdjpyR6ekhnGaZFmrPsyK5phPFFA8wTeDW-TWL53zGMSviaEQAVPLoISWK+IWbqp6maVBPDdr26GOkOt4IFlVwEQ4Zj5T4Pzke45SmD4ejfp5ei+YpUTAqqoEqag0x4DuWCsbaOzJAwbXXhlPq1D+uL+bWnQ2MSVHXAV36-L8PjGLVS0rWtHZ7Kwu3pQWoSGPYRgkT5AzVv+gTFfYpWGNYxGHZ0OgmI9yjPetrJsa11ntVh5yVqVb7fmYQa1tWXrNLUXjaD4QM-NUERzfSoFgGoEUAK6NRQGAABoYIaNApmwtCGj2ezZry6P7XxeHBoJREiWR5aBL9TymD5r4-Z4yo0wtYL00zLPs5z3Pwam6aZkLaW2cOuECYRwmkWJzSPHh-V9eY013DO8NYJI5DyJAKRpBkaN7V9QQ9bljsFUNsuPGVnjmBDsMK2rwxRmC0zxD7qQsMkACaH1m513U5bWeWSYNRXlnjDn-iRfzGP1pjBeryfjKnhDp37udOsOBe9cX4dl3bspEA8PSkh8Ay+Y9OCoBuYDhRAvuof7wuB8OtEGCYzsArYDjkVSbRymDJR9JY-iRHNqDSJM8DZLT8Sm53nUALS24gz+1YkYD3x1vEEb9I31HcJ8oZ3AvwQCPSi-QQH3Cqr6es782wsQWF-DGiAwagzaDSWUPlfh3B+I9cCiCoDINFtYLw-5azGAmiNJ4u9RqzmCE8ModEzDw3CpFJBV5Ppd2nNjGsdRYEzl9MVLyFwBggKpI8OW8NlqrSRkQzhedeK-E8EPY69gHAEk0O4YkJMiAzkGh0QMHxJK1S1huZm0JiEFgsK6WslYqEq2JOAgIlRnZBHuJQ92nswDewgFY7hC4h6Bl6L5X0NDZaw0cv9Ho1h7jVHsLVFu5A-EKIfko4e3k6h3AmmEV8FhiTETJN1AM1RdAAUBI3FsoUp4zznv4zqPxSh6NxCAzyDhzDkQ+N5WoNgfg1wbpEIAA */
    id: 'sendEmail',
    initial: 'idle',
    context: {
      actionId: 'send_email',
      parameters: {},
      missing: [],
      result: null,
      execution: null,
    },
    states: {
      idle: {
        on: {
          SUBMIT_MESSAGE: 'identifying',
          RESET: { actions: 'resetWorkflow' },
        },
      },
      identifying: {
        on: {
          IDENTIFIED: [
            {
              guard: 'resultHasMissingParameters',
              target: 'collecting',
              actions: 'storeIdentificationResult',
            },
            {
              guard: 'resultIsComplete',
              target: 'confirming',
              actions: 'storeIdentificationResult',
            },
            {
              target: 'failed',
              actions: 'storeIdentificationError',
            },
          ],
          NEEDS_CLARIFICATION: {
            target: 'clarifying',
            actions: 'storeClarificationResult',
          },
          IDENTIFICATION_FAILED: {
            target: 'failed',
            actions: 'storeIdentificationError',
          },
          CANCEL: 'cancelled',
        },
      },
      clarifying: {
        on: {
          SUBMIT_MESSAGE: 'identifying',
          CLARIFICATION_CHOSEN: [
            {
              guard: 'clarificationResultHasMissingParameters',
              target: 'collecting',
              actions: 'storeClarificationChoice',
            },
            {
              guard: 'clarificationResultIsComplete',
              target: 'confirming',
              actions: 'storeClarificationChoice',
            },
          ],
          CANCEL: 'cancelled',
          RESET: {
            target: 'idle',
            actions: 'resetWorkflow',
          },
        },
      },
      collecting: {
        on: {
          PARAMETER_PROVIDED: [
            {
              guard: 'stillMissingParameters',
              target: 'collecting',
              actions: 'mergeParameter',
            },
            {
              guard: 'allParametersPresent',
              target: 'confirming',
              actions: 'mergeParameter',
            },
          ],
          CANCEL: 'cancelled',
        },
      },
      confirming: {
        on: {
          CONFIRM: 'executing',
          EDIT: {
            target: 'collecting',
            actions: 'startEditing',
          },
          CANCEL: 'cancelled',
        },
      },
      executing: {
        on: {
          EXECUTION_SUCCEEDED: {
            target: 'completed',
            actions: 'storeExecutionSuccess',
          },
          EXECUTION_FAILED: {
            target: 'failed',
            actions: 'storeExecutionError',
          },
        },
      },
      completed: {
        on: {
          RESET: {
            target: 'idle',
            actions: 'resetWorkflow',
          },
        },
      },
      failed: {
        on: {
          RETRY: [
            {
              guard: 'retryCanConfirm',
              target: 'confirming',
            },
            {
              target: 'idle',
              actions: 'resetWorkflow',
            },
          ],
          RESET: {
            target: 'idle',
            actions: 'resetWorkflow',
          },
        },
      },
      cancelled: {
        on: {
          RESET: {
            target: 'idle',
            actions: 'resetWorkflow',
          },
        },
      },
    },
  });
}
