import { createActor } from 'xstate';
import { describe, expect, it } from 'vitest';
import { createSendEmailWorkflow } from '../src/email/send-email.workflow';

function makeResult(missing: string[], parameters: Array<{ name: string; value: string }> = []) {
  return {
    action: {
      identifier: 'send_email',
      status: 'clear' as const,
      alternatives: [],
      summary: 'Send email.',
    },
    parameters: parameters.map((parameter) => ({
      name: parameter.name,
      value: parameter.value,
      normalized: parameter.value,
      evidence: parameter.value,
    })),
    missing,
    assumptions: [],
    ambiguities: [],
  };
}

describe('sendEmailWorkflow', () => {
  it('moves from identifying to collecting when parameters are missing', () => {
    const actor = createActor(createSendEmailWorkflow());
    actor.start();
    actor.send({ type: 'SUBMIT_MESSAGE', message: 'Send an email' });
    actor.send({ type: 'IDENTIFIED', result: makeResult(['to', 'subject', 'body']) });

    expect(actor.getSnapshot().value).toBe('collecting');
    expect(actor.getSnapshot().context.missing).toEqual(['to', 'subject', 'body']);
  });

  it('moves to confirming when all parameters are present', () => {
    const actor = createActor(createSendEmailWorkflow());
    actor.start();
    actor.send({ type: 'SUBMIT_MESSAGE', message: 'Send an email' });
    actor.send({
      type: 'IDENTIFIED',
      result: makeResult([], [
        { name: 'to', value: 'john@acme.com' },
        { name: 'subject', value: 'Invoice' },
        { name: 'body', value: 'Please find the invoice attached.' },
      ]),
    });

    expect(actor.getSnapshot().value).toBe('confirming');
    expect(actor.getSnapshot().context.parameters.to).toBe('john@acme.com');
  });

  it('collects parameters one at a time', () => {
    const actor = createActor(createSendEmailWorkflow());
    actor.start();
    actor.send({ type: 'SUBMIT_MESSAGE', message: 'Send an email' });
    actor.send({ type: 'IDENTIFIED', result: makeResult(['to', 'subject', 'body']) });
    actor.send({ type: 'PARAMETER_PROVIDED', name: 'to', value: 'john@acme.com' });

    expect(actor.getSnapshot().value).toBe('collecting');
    expect(actor.getSnapshot().context.missing).toEqual(['subject', 'body']);

    actor.send({ type: 'PARAMETER_PROVIDED', name: 'subject', value: 'Invoice' });
    actor.send({ type: 'PARAMETER_PROVIDED', name: 'body', value: 'Please find the invoice attached.' });

    expect(actor.getSnapshot().value).toBe('confirming');
  });

  it('applies a clarification choice and continues collecting', () => {
    const actor = createActor(createSendEmailWorkflow());
    actor.start();
    actor.send({ type: 'SUBMIT_MESSAGE', message: 'Email John' });
    actor.send({
      type: 'NEEDS_CLARIFICATION',
      result: makeResult(['subject', 'body'], [{ name: 'to', value: 'john@acme.com' }]),
    });

    expect(actor.getSnapshot().value).toBe('clarifying');

    actor.send({
      type: 'CLARIFICATION_CHOSEN',
      result: makeResult(['subject', 'body'], [{ name: 'to', value: 'john@acme.com' }]),
    });

    expect(actor.getSnapshot().value).toBe('collecting');
    expect(actor.getSnapshot().context.parameters.to).toBe('john@acme.com');
    expect(actor.getSnapshot().context.missing).toEqual(['subject', 'body']);
  });

  it('confirms immediately when a clarification choice is complete', () => {
    const actor = createActor(createSendEmailWorkflow());
    actor.start();
    actor.send({ type: 'SUBMIT_MESSAGE', message: 'Email John' });
    actor.send({ type: 'NEEDS_CLARIFICATION', result: makeResult(['to']) });
    actor.send({
      type: 'CLARIFICATION_CHOSEN',
      result: makeResult([], [
        { name: 'to', value: 'john@acme.com' },
        { name: 'subject', value: 'Invoice' },
        { name: 'body', value: 'Please find the invoice attached.' },
      ]),
    });

    expect(actor.getSnapshot().value).toBe('confirming');
  });

  it('asks for all fields again when editing a confirmed email', () => {
    const actor = createActor(createSendEmailWorkflow());
    actor.start();
    actor.send({ type: 'SUBMIT_MESSAGE', message: 'Send an email' });
    actor.send({
      type: 'IDENTIFIED',
      result: makeResult([], [
        { name: 'to', value: 'john@acme.com' },
        { name: 'subject', value: 'Invoice' },
        { name: 'body', value: 'Please find the invoice attached.' },
      ]),
    });
    actor.send({ type: 'EDIT' });

    expect(actor.getSnapshot().value).toBe('collecting');
    expect(actor.getSnapshot().context.missing).toEqual(['to', 'subject', 'body']);
    expect(actor.getSnapshot().context.parameters.to).toBe('john@acme.com');
  });

  it('executes and completes after confirmation', () => {
    const actor = createActor(createSendEmailWorkflow());
    actor.start();
    actor.send({ type: 'SUBMIT_MESSAGE', message: 'Send an email' });
    actor.send({
      type: 'IDENTIFIED',
      result: makeResult([], [
        { name: 'to', value: 'john@acme.com' },
        { name: 'subject', value: 'Invoice' },
        { name: 'body', value: 'Please find the invoice attached.' },
      ]),
    });
    actor.send({ type: 'CONFIRM' });

    expect(actor.getSnapshot().value).toBe('executing');

    actor.send({ type: 'EXECUTION_SUCCEEDED', messageId: 'msg-123' });

    expect(actor.getSnapshot().value).toBe('completed');
    expect(actor.getSnapshot().context.execution?.messageId).toBe('msg-123');
  });

  it('returns to confirming after retry', () => {
    const actor = createActor(createSendEmailWorkflow());
    actor.start();
    actor.send({ type: 'SUBMIT_MESSAGE', message: 'Send an email' });
    actor.send({
      type: 'IDENTIFIED',
      result: makeResult([], [
        { name: 'to', value: 'john@acme.com' },
        { name: 'subject', value: 'Invoice' },
        { name: 'body', value: 'Please find the invoice attached.' },
      ]),
    });
    actor.send({ type: 'CONFIRM' });
    actor.send({ type: 'EXECUTION_FAILED', error: 'Brevo request failed' });

    expect(actor.getSnapshot().value).toBe('failed');

    actor.send({ type: 'RETRY' });

    expect(actor.getSnapshot().value).toBe('confirming');
  });

  it('resets to idle when retrying before parameters are collected', () => {
    const actor = createActor(createSendEmailWorkflow());
    actor.start();
    actor.send({ type: 'SUBMIT_MESSAGE', message: 'Send an email' });
    actor.send({ type: 'IDENTIFICATION_FAILED', error: 'LLM unavailable' });

    expect(actor.getSnapshot().value).toBe('failed');

    actor.send({ type: 'RETRY' });

    expect(actor.getSnapshot().value).toBe('idle');
    expect(actor.getSnapshot().context.error).toBeUndefined();
  });

  it('cancels and resets', () => {
    const actor = createActor(createSendEmailWorkflow());
    actor.start();
    actor.send({ type: 'SUBMIT_MESSAGE', message: 'Send an email' });
    actor.send({ type: 'IDENTIFIED', result: makeResult(['to', 'subject', 'body']) });
    actor.send({ type: 'CANCEL' });

    expect(actor.getSnapshot().value).toBe('cancelled');

    actor.send({ type: 'RESET' });

    expect(actor.getSnapshot().value).toBe('idle');
    expect(actor.getSnapshot().context.parameters).toEqual({});
  });
});
