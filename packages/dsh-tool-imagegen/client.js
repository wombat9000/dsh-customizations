window.__ModuleLoader__.load({
  id: '@local/dsh-tool-imagegen',
  factory: (require) => {
    const module = { exports: {} }
    const exports = module.exports
    const React = require('react')

    const styles = {
      card: {
        display: 'flex',
        flexDirection: 'column',
        gap: '10px',
        padding: '12px',
        border: '1px solid var(--dsw-alias-border-l2-darkmode-thin)',
        borderRadius: '12px',
        background: 'var(--dsw-specific-input-major)',
      },
      header: {
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        gap: '12px',
        fontSize: '13px',
        color: 'var(--dsw-alias-label-secondary)',
      },
      title: { fontWeight: 650, color: 'var(--dsw-alias-label-primary)' },
      gallery: { display: 'flex', flexWrap: 'wrap', gap: '10px' },
      frame: {
        display: 'block',
        maxWidth: 'min(100%, 560px)',
        padding: 0,
        border: 0,
        borderRadius: '10px',
        background: 'transparent',
        cursor: 'zoom-in',
        overflow: 'hidden',
      },
      image: {
        display: 'block',
        maxWidth: '100%',
        width: 'auto',
        height: 'auto',
        maxHeight: '420px',
        borderRadius: '10px',
        objectFit: 'contain',
      },
      placeholder: {
        display: 'grid',
        placeItems: 'center',
        minWidth: '220px',
        minHeight: '140px',
        padding: '16px',
        borderRadius: '10px',
        background: 'var(--dsw-alias-interactive-bg-hover)',
        color: 'var(--dsw-alias-label-secondary)',
        fontSize: '13px',
      },
      error: { color: 'var(--dsw-alias-label-error)', cursor: 'pointer' },
      backdrop: {
        position: 'fixed',
        inset: 0,
        zIndex: 1000,
        display: 'grid',
        placeItems: 'center',
        padding: '40px',
        border: 0,
        background: 'var(--dsw-alias-bg-mask-1)',
        backdropFilter: 'var(--dsw-mask-blur)',
        cursor: 'zoom-out',
      },
      fullImage: {
        display: 'block',
        maxWidth: 'min(100%, 1600px)',
        maxHeight: 'calc(100vh - 80px)',
        borderRadius: '12px',
        objectFit: 'contain',
        boxShadow: 'var(--dsw-shadow-lv3)',
      },
    }

    function imageBlocks(block) {
      if (
        block === undefined ||
        block === null ||
        block.kind !== 'tool-result' ||
        !Array.isArray(block.content)
      )
        return []
      return block.content.filter(
        (item) =>
          item !== null &&
          typeof item === 'object' &&
          item.type === 'image' &&
          item.attachment !== undefined,
      )
    }

    function textSummary(block) {
      if (
        block === undefined ||
        block === null ||
        block.kind !== 'tool-result' ||
        !Array.isArray(block.content)
      )
        return undefined
      const item = block.content.find(
        (candidate) =>
          candidate !== null &&
          typeof candidate === 'object' &&
          candidate.type === 'text' &&
          typeof candidate.text === 'string',
      )
      return item?.text
    }

    function imageUrl(payload) {
      const bytes = Uint8Array.from(payload.data)
      const mediaType = payload.attachment?.mediaType || 'application/octet-stream'
      if (typeof URL.createObjectURL !== 'function') {
        let binary = ''
        for (const byte of bytes) binary += String.fromCharCode(byte)
        return { url: `data:${mediaType};base64,${btoa(binary)}`, disposable: false }
      }
      return {
        url: URL.createObjectURL(new Blob([bytes.buffer], { type: mediaType })),
        disposable: true,
      }
    }

    function ImagePreview({ attachment, sessionId, readAttachment }) {
      const [src, setSrc] = React.useState(undefined)
      const [failure, setFailure] = React.useState(undefined)
      const [open, setOpen] = React.useState(false)
      const [attempt, setAttempt] = React.useState(0)

      React.useEffect(() => {
        let active = true
        let loaded
        setSrc(undefined)
        setFailure(undefined)
        Promise.resolve(readAttachment(sessionId, attachment)).then(
          (payload) => {
            loaded = imageUrl(payload)
            if (!active) {
              if (loaded.disposable) URL.revokeObjectURL(loaded.url)
              return
            }
            setSrc(loaded.url)
          },
          (error) => {
            if (active) setFailure(error instanceof Error ? error.message : String(error))
          },
        )
        return () => {
          active = false
          if (loaded?.disposable) URL.revokeObjectURL(loaded.url)
        }
      }, [attachment.attachmentId, sessionId, readAttachment, attempt])

      if (failure !== undefined) {
        return React.createElement(
          'button',
          {
            type: 'button',
            style: { ...styles.placeholder, ...styles.error },
            title: failure,
            onClick: () => setAttempt((value) => value + 1),
          },
          'Image failed to load — retry',
        )
      }
      if (src === undefined)
        return React.createElement('div', { style: styles.placeholder }, 'Loading generated image…')

      const label = attachment.name || 'Generated image'
      return React.createElement(
        React.Fragment,
        null,
        React.createElement(
          'button',
          {
            type: 'button',
            style: styles.frame,
            title: 'View full image',
            'aria-label': `${label}, view full image`,
            onClick: () => setOpen(true),
          },
          React.createElement('img', {
            src,
            alt: label,
            style: styles.image,
            width: attachment.width,
            height: attachment.height,
          }),
        ),
        open
          ? React.createElement(
              'button',
              {
                type: 'button',
                style: styles.backdrop,
                'aria-label': 'Close image preview',
                onClick: () => setOpen(false),
              },
              React.createElement('img', {
                src,
                alt: label,
                style: styles.fullImage,
                onClick: (event) => event.stopPropagation(),
              }),
            )
          : null,
      )
    }

    function GenerateImageToolView({ block, sessionId, readAttachment }) {
      if (block.kind !== 'tool-result') {
        return React.createElement(
          'div',
          { style: styles.card },
          React.createElement(
            'div',
            { style: styles.header },
            React.createElement('span', { style: styles.title }, 'Generating image…'),
          ),
        )
      }

      const images = imageBlocks(block)
      const summary = textSummary(block)
      return React.createElement(
        'div',
        { style: styles.card },
        React.createElement(
          'div',
          { style: styles.header },
          React.createElement(
            'span',
            { style: styles.title },
            block.isError ? 'Image generation failed' : 'Generated image',
          ),
          images.length > 0
            ? React.createElement(
                'span',
                null,
                `${images.length} image${images.length === 1 ? '' : 's'}`,
              )
            : null,
        ),
        images.length > 0
          ? React.createElement(
              'div',
              { style: styles.gallery },
              images.map((image, index) =>
                React.createElement(ImagePreview, {
                  key: `${image.attachment.attachmentId}:${index}`,
                  attachment: image.attachment,
                  sessionId,
                  readAttachment,
                }),
              ),
            )
          : React.createElement(
              'div',
              {
                style: block.isError
                  ? { ...styles.placeholder, ...styles.error }
                  : styles.placeholder,
              },
              summary || 'No image returned.',
            ),
      )
    }

    const inject = ['slots', 'sessions']

    function apply(ctx) {
      const readAttachment = async (sessionId, attachment) => {
        const binding = ctx.sessions.binding(sessionId)
        if (binding?.session === undefined)
          throw new Error(`Image session is unavailable: ${sessionId}`)
        const result = await binding.session.readAttachment(attachment.attachmentId)
        if (!result.ok) throw new Error(`${result.error.code}: ${result.error.message}`)
        return result.value
      }
      ctx.slots.inject('tool.call.toolview', () =>
        ctx.slots.register(
          {
            name: 'tool.call.toolview',
            key: 'generate_image',
            inject: () => ({ readAttachment }),
          },
          GenerateImageToolView,
        ),
      )
    }

    exports.apply = apply
    exports.inject = inject
    exports.GenerateImageToolView = GenerateImageToolView
    exports.ImagePreview = ImagePreview
    exports.imageBlocks = imageBlocks
    exports.textSummary = textSummary
    return module.exports
  },
})
