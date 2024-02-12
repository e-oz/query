import { assertInInjectionContext, DestroyRef, effect, inject, signal, } from '@angular/core'
import { type DefaultedQueryObserverOptions, notifyManager, type QueryClient, type QueryKey, type QueryObserver, QueryObserverResult } from '@tanstack/query-core'
import { signalProxy } from './signal-proxy'
import type { CreateBaseQueryOptions, CreateBaseQueryResult } from './types'

/**
 * Base implementation for `injectQuery` and `injectInfiniteQuery`.
 */
export function createBaseQuery<
  TQueryFnData,
  TError,
  TData,
  TQueryData,
  TQueryKey extends QueryKey,
>(
  options: (
    client: QueryClient,
  ) => CreateBaseQueryOptions<
    TQueryFnData,
    TError,
    TData,
    TQueryData,
    TQueryKey
  >,
  Observer: typeof QueryObserver,
  queryClient: QueryClient,
): CreateBaseQueryResult<TData, TError> {
  assertInInjectionContext(createBaseQuery)
  const destroyRef = inject(DestroyRef)

  /**
   * Signal that has the default options from query client applied
   * effect() is used so signals can be inserted into the options
   * making it reactive. Wrapping options in a function ensures embedded expressions
   * are preserved and can keep being applied after signal changes
   */
  const NON_INITIALIZED = Symbol('NonInitializedSignal');
  type DefaultedOptions = DefaultedQueryObserverOptions<TQueryFnData, TError, TData, TQueryData, TQueryKey>;
  const defaultedOptionsSignal = signal<DefaultedOptions | Symbol>(NON_INITIALIZED);

  effect(() => {
    const defaultedOptions = queryClient.defaultQueryOptions(
      options(queryClient),
    );
    defaultedOptions._optimisticResults = 'optimistic';
    defaultedOptionsSignal.set(defaultedOptions);
  }, { allowSignalWrites: true });

  let observer: QueryObserver<
    TQueryFnData,
    TError,
    TData,
    TQueryData,
    TQueryKey
  > | undefined = undefined;

  const resultSignal = signal<QueryObserverResult<TData, TError> | undefined>(undefined);

  effect(
    () => {
      // Do not notify on updates because of changes in the options because
      // these changes should already be reflected in the optimistic result.

      /**
       * OZ:
       * Code does the opposite (to comment) - it will update `resultSignal`
       * every time signals inside `options` are modified, because of
       * `computed()`/`effect()` used for `defaultedOptionsSignal`.
       */
      const defaultedOptions = defaultedOptionsSignal()
      if (defaultedOptions !== NON_INITIALIZED) {
        const newOptions = defaultedOptions as DefaultedOptions;

        if (!observer) {
          observer = new Observer<
            TQueryFnData,
            TError,
            TData,
            TQueryData,
            TQueryKey
          >(queryClient, newOptions);

          // observer.trackResult is not used as this optimization is not needed for Angular
          const unsubscribe = observer.subscribe(
            notifyManager.batchCalls((val) => resultSignal.set(val)),
          )
          destroyRef.onDestroy(unsubscribe)
        }

        observer.setOptions(newOptions, {
          listeners: false,
        })
        resultSignal.set(observer.getOptimisticResult(newOptions))
      }
    },
    { allowSignalWrites: true },
  )

  /**
   * OZ:
   * Looks like I messed with the types,
   * or it's just because of possible `undefined`
   */
  return signalProxy(resultSignal) as CreateBaseQueryResult<TData, TError>
}
