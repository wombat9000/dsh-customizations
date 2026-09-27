// Native V4 display-fixture records. These helpers never dispatch a tool.
export function unattemptedToolResult(callId, turn, step, sequence) {
  return {
    type: 'tool/result',
    surfaceOp: 'append',
    data: {
      turn,
      step,
      error: { name: 'ToolNotStartedError', code: 'TOOL_NOT_STARTED' },
      message: {
        id: `interrupted-tool-result-${callId}-${sequence}`,
        role: 'tool',
        source: { kind: 'tool', callId },
        toolCallId: callId,
        isError: true,
        content: [
          {
            type: 'text',
            text: 'The tool call was interrupted before the Harness recorded it as started. Retry it if it is still needed.',
          },
        ],
      },
    },
  }
}
