import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { logger } from './logger';

describe('logger', () => {
  let debugSpy: any;
  let infoSpy: any;
  let warnSpy: any;
  let errorSpy: any;

  beforeEach(() => {
    debugSpy = vi.spyOn(console, 'debug').mockImplementation(() => {});
    infoSpy = vi.spyOn(console, 'info').mockImplementation(() => {});
    warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('should format message with prefix [Lucen]', () => {
    logger.setLevel('debug');
    logger.info('hello', 123);
    expect(infoSpy).toHaveBeenCalledWith('[Lucen]', 'hello', 123);
  });

  it('should respect configured log level and ignore lower logs', () => {
    logger.setLevel('warn');

    logger.debug('should not print');
    logger.info('should not print');
    expect(debugSpy).not.toHaveBeenCalled();
    expect(infoSpy).not.toHaveBeenCalled();

    logger.warn('should print warn');
    logger.error('should print error');
    expect(warnSpy).toHaveBeenCalledWith('[Lucen]', 'should print warn');
    expect(errorSpy).toHaveBeenCalledWith('[Lucen]', 'should print error');
  });

  it('should not log anything if log level is none', () => {
    logger.setLevel('none');
    logger.debug('test');
    logger.info('test');
    logger.warn('test');
    logger.error('test');

    expect(debugSpy).not.toHaveBeenCalled();
    expect(infoSpy).not.toHaveBeenCalled();
    expect(warnSpy).not.toHaveBeenCalled();
    expect(errorSpy).not.toHaveBeenCalled();
  });
});
