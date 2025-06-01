export function On(event: string): MethodDecorator {
  return function (
    target: any,
    propertyKey: string | symbol,
    descriptor: PropertyDescriptor
  ) {
    if (!target._handlers) target._handlers = [];
    target._handlers.push({ event, method: descriptor.value });
  };
}

export function Controller() {
  return function (constructor: any) {};
}
